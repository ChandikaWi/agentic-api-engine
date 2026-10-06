import json
import asyncio
from fastapi import FastAPI, Request, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Dict
from datetime import datetime

# Import engine logic
from ingest import build_vector_store
from agent import app as agent_app

# DB and Auth
from database import engine, get_db
import models
from auth import verify_password, get_password_hash, create_access_token, SECRET_KEY, ALGORITHM
from fastapi.security import OAuth2PasswordBearer
import jwt

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None:
        raise credentials_exception
    return user


# Initialize Database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Agentic API Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Schemas
class IngestRequest(BaseModel):
    url: str

class UserCreate(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class AccountUpdate(BaseModel):
    new_username: str = None
    new_password: str = None

class JobResponse(BaseModel):
    id: int
    task: str
    status: str
    created_at: datetime
    updated_at: datetime
    logs: str

    class Config:
        from_attributes = True

# Auth Endpoints
@app.post("/register", response_model=Token)
def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = get_password_hash(user.password)
    new_user = models.User(username=user.username, password_hash=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    access_token = create_access_token(data={"sub": new_user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/login", response_model=Token)
def login(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if not db_user or not verify_password(user.password, db_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(data={"sub": db_user.username})
    return {"access_token": access_token, "token_type": "bearer"}

# Engine Endpoints
@app.post("/ingest")
async def ingest_url(req: IngestRequest):
    try:
        build_vector_store([req.url])
        return {"status": "success", "message": f"Successfully ingested {req.url}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/jobs", response_model=List[JobResponse])
def get_jobs(username: str, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    jobs = db.query(models.Job).filter(models.Job.user_id == user.id).order_by(models.Job.created_at.desc()).all()
    return jobs

@app.post("/jobs/{job_id}/retry")
def retry_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.status = "pending"
    job.logs = ""
    db.commit()
    return {"status": "success", "message": f"Job {job_id} reset to pending."}

@app.delete("/jobs/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(job)
    db.commit()
    return {"status": "success"}

@app.put("/update_account")
def update_account(
    update_data: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if not update_data.new_username and not update_data.new_password:
        raise HTTPException(status_code=400, detail="No updates provided")
        
    if update_data.new_username:
        if update_data.new_username != current_user.username:
            existing_user = db.query(models.User).filter(models.User.username == update_data.new_username).first()
            if existing_user:
                raise HTTPException(status_code=400, detail="Username already taken")
            current_user.username = update_data.new_username
            
    if update_data.new_password:
        current_user.password_hash = get_password_hash(update_data.new_password)
        
    db.commit()
    db.refresh(current_user)
    
    access_token = create_access_token(data={"sub": current_user.username})
    return {"access_token": access_token, "token_type": "bearer", "username": current_user.username}

@app.delete("/account")
def delete_account(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Delete associated jobs first
    db.query(models.Job).filter(models.Job.user_id == current_user.id).delete()
    # Delete user
    db.delete(current_user)
    db.commit()
    return {"status": "success", "message": "Account deleted successfully"}

# WebSocket Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, ws: WebSocket, client_id: str):
        await ws.accept()
        self.active_connections[client_id] = ws

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def send_json(self, message: dict, client_id: str):
        ws = self.active_connections.get(client_id)
        if ws:
            await ws.send_json(message)

manager = ConnectionManager()

@app.websocket("/ws/agent/{username}")
async def websocket_agent_endpoint(websocket: WebSocket, username: str, task: str = None, job_id: int = None):
    await manager.connect(websocket, username)
    from database import SessionLocal
    
    job = None
    with SessionLocal() as db:
        if job_id:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job:
                job.status = "running"
                db.commit()
                task = job.task
        elif username:
            user = db.query(models.User).filter(models.User.username == username).first()
            if user:
                job = models.Job(user_id=user.id, task=task, status="running")
                db.add(job)
                db.commit()
                db.refresh(job)
                job_id = job.id

    thread_config = {"configurable": {"thread_id": str(job_id) if job_id else username}}
    
    initial_state = {
        "task": task,
        "context": [],
        "current_code": "",
        "dependencies": [],
        "error_log": "",
        "stdout": "",
        "success": False,
        "iteration": 0,
        "next_node": "",
        "human_feedback": ""
    }

    log_accumulator = []
    agent_task = None
    current_state_cache = {}

    async def run_agent():
        nonlocal current_state_cache
        try:
            # Check if there's already a saved state for this thread
            saved_state = agent_app.get_state(thread_config)
            
            # Use astream which supports async 
            # If there's a saved state and it's paused, just continue by calling astream(None)
            input_state = None if saved_state and len(saved_state.tasks) > 0 else initial_state
            
            async for output in agent_app.astream(input_state, config=thread_config):
                # When astream yields, it means a node finished
                node_name = list(output.keys())[0]
                state_updates = output[node_name]
                current_state_cache.update(state_updates)
                
                payload = {
                    "node": node_name,
                    "state": state_updates
                }
                log_accumulator.append(json.dumps(payload))
                await manager.send_json({"event": "message", "data": payload}, username)
            
            # If the loop finishes naturally, check if it's paused or truly ended
            final_state = agent_app.get_state(thread_config)
            if final_state and len(final_state.tasks) > 0:
                # It hit a breakpoint (interrupt_before="critic")
                await manager.send_json({
                    "event": "paused", 
                    "message": "Execution paused before Critic node. Provide feedback or continue.",
                    "node": "critic"
                }, username)
            else:
                # Finished completely
                await finish_job("completed" if current_state_cache.get("success") else "failed")
                await manager.send_json({"event": "finished", "message": "Execution Completed."}, username)
                
        except asyncio.CancelledError:
            # Agent was interrupted by user
            await manager.send_json({"event": "interrupted", "message": "Execution was cancelled by the user."}, username)
            await finish_job("cancelled")
        except Exception as e:
            log_accumulator.append(str(e))
            await manager.send_json({"event": "error", "message": str(e)}, username)
            await finish_job("failed")
            await manager.send_json({"event": "finished", "message": "Execution Failed due to error."}, username)

    async def finish_job(status_val):
        if job_id:
            with SessionLocal() as db:
                db_job = db.query(models.Job).filter(models.Job.id == job_id).first()
                if db_job:
                    db_job.status = status_val
                    db_job.logs = "\n".join(log_accumulator)
                    db.commit()

    # Start the agent in the background
    agent_task = asyncio.create_task(run_agent())

    try:
        while True:
            # Listen for incoming commands (Hitl, Interrupt)
            data = await websocket.receive_text()
            payload = json.loads(data)
            action = payload.get("action")
            
            if action == "interrupt":
                if agent_task and not agent_task.done():
                    agent_task.cancel()
                    
            elif action == "feedback":
                feedback = payload.get("data", "")
                
                # Update state with feedback
                if feedback:
                    agent_app.update_state(thread_config, {"human_feedback": feedback})
                
                # Resume execution
                agent_task = asyncio.create_task(run_agent())
                await manager.send_json({"event": "resumed", "message": "Resuming execution..."}, username)
                    
    except WebSocketDisconnect:
        manager.disconnect(username)
        if agent_task and not agent_task.done():
            agent_task.cancel()
        await finish_job("cancelled")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True, reload_excludes=["temp_execution/*", "chroma_db/*"])
