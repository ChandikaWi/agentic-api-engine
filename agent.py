import os
import json
from typing import TypedDict, Optional, List
from langgraph.graph import StateGraph, START, END
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_chroma import Chroma
from pydantic import BaseModel, Field
from sandbox import run_code_sandbox
from dotenv import load_dotenv
from langgraph.checkpoint.memory import MemorySaver

load_dotenv()

# Complex LangGraph Architecture

# Structured Data Models
class DeveloperOutput(BaseModel):
    reasoning: str = Field(description="Step-by-step reasoning for the code structure.")
    code: str = Field(description="The executable Python script to achieve the task.")
    dependencies: List[str] = Field(default=[], description="List of PyPI packages required to run this code (e.g., ['requests', 'pandas']).")

class CriticOutput(BaseModel):
    analysis: str = Field(description="Analysis of what went wrong.")
    next_action: str = Field(description="Must be one of: 'research' (needs more docs), 'rewrite' (code bug), or 'success' (it worked).")
    search_query: Optional[str] = Field(default=None, description="If next_action is 'research', provide the search query.")

# Define the State
class AgentState(TypedDict):
    task: str
    context: List[str]
    current_code: str
    dependencies: List[str]
    error_log: str
    stdout: str
    success: bool
    iteration: int
    next_node: str # used for dynamic routing
    human_feedback: str # used for HITL

# Initialize Models
llm = ChatGoogleGenerativeAI(model="gemini-3.5-flash", temperature=0)
structured_developer_llm = llm.with_structured_output(DeveloperOutput)
structured_critic_llm = llm.with_structured_output(CriticOutput)
embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-2")

def get_retriever():
    persist_directory = "./chroma_db"
    if os.path.exists(persist_directory):
        vectorstore = Chroma(persist_directory=persist_directory, embedding_function=embeddings)
        return vectorstore.as_retriever(search_kwargs={"k": 4})
    return None

# Define the Nodes
def researcher_node(state: AgentState):
    print("--- 🔍 RESEARCHER ---")
    retriever = get_retriever()
    
    # If the critic provided a specific query, use it, else use task
    search_query = state.get("error_log", "") if state.get("error_log") else state["task"]
    
    print(f"Querying vector DB for: '{search_query}'...")
    if retriever:
        docs = retriever.invoke(search_query)
        new_context = "\n\n".join([doc.page_content for doc in docs])
    else:
        new_context = "No context available. Vector DB not found."
        
    print(f"Retrieved {len(new_context)} characters of context.")
    
    # Append context
    context = state.get("context", [])
    context.append(new_context)
    
    return {"context": context, "human_feedback": ""} # reset feedback after use

def developer_node(state: AgentState):
    print("--- 💻 DEVELOPER ---")
    
    all_context = "\n\n=== NEXT DOC SECTION ===\n\n".join(state["context"])
    feedback_str = f"Human Feedback / Hint to consider:\n{state.get('human_feedback')}" if state.get("human_feedback") else ""
    
    prompt = f"""
    You are an expert autonomous Python developer integrating an API.
    
    Task: {state["task"]}
    
    API Documentation Context:
    {all_context}
    
    Previous Error (if any):
    {state["error_log"]}
    
    Previous Code (if any):
    {state["current_code"]}
    
    {feedback_str}
    
    Write the executable Python script to achieve the task.
    Important Requirements:
    1. The script must be fully self-contained.
    2. Print the final result clearly to stdout so the executor can capture it.
    3. Identify any pip dependencies needed (e.g. 'requests').
    """
    
    print("Generating code and identifying dependencies...")
    response = structured_developer_llm.invoke(prompt)
    
    return {
        "current_code": response.code,
        "dependencies": response.dependencies,
        "error_log": "", # Clear error log before execution
        "human_feedback": "" # reset feedback
    }

def executor_node(state: AgentState):
    print("--- ⚡ EXECUTOR ---")
    iteration = state.get("iteration", 0) + 1
    
    print(f"Iteration {iteration}: Running code in sandbox...")
    result = run_code_sandbox(state["current_code"], state["dependencies"])
    
    success = result["success"]
    return {
        "success": success,
        "stdout": result.get("stdout", ""),
        "error_log": result.get("stderr", ""),
        "iteration": iteration
    }

def critic_node(state: AgentState):
    print("--- 🧠 CRITIC ---")
    
    feedback_str = f"Human Hint provided:\n{state.get('human_feedback')}" if state.get("human_feedback") else ""
    
    # If successful and no human feedback, route to end
    if state["success"] and not state.get("human_feedback"):
        return {"next_node": "end"}
        
    if state["iteration"] >= 4:
        print("Max iterations reached. Giving up.")
        return {"next_node": "end"}
        
    feedback_str = f"Human Hint provided:\n{state.get('human_feedback')}" if state.get("human_feedback") else ""
    
    prompt = f"""
    You are an expert QA engineer and system critic.
    The execution of a Python script failed.
    
    Task: {state["task"]}
    Code:
    {state["current_code"]}
    
    Error Output (or stdout if it succeeded but you are giving feedback):
    {state["error_log"] or state["stdout"]}
    
    {feedback_str}
    
    Analyze the error. 
    - If the error is a missing module/dependency that wasn't declared, or a syntax error, or a logical bug in Python code, the next action should be 'rewrite'.
    - If the error is an API 404, 401, 400 or implies missing knowledge about the API endpoint/payload, the next action should be 'research'.
    """
    
    response = structured_critic_llm.invoke(prompt)
    
    if response.next_action == "research":
        return {"next_node": "researcher", "error_log": response.search_query or state["error_log"], "human_feedback": ""}
    else:
        return {"next_node": "developer", "human_feedback": ""}

# Define the Edge Logic
def route_after_critic(state: AgentState):
    return state["next_node"]

# Build the Graph
workflow = StateGraph(AgentState)

workflow.add_node("researcher", researcher_node)
workflow.add_node("developer", developer_node)
workflow.add_node("executor", executor_node)
workflow.add_node("critic", critic_node)

workflow.add_edge(START, "researcher")
workflow.add_edge("researcher", "developer")
workflow.add_edge("developer", "executor")
workflow.add_edge("executor", "critic")

workflow.add_conditional_edges(
    "critic",
    route_after_critic,
    {
        "researcher": "researcher",
        "developer": "developer",
        "end": END
    }
)

memory = MemorySaver()
app = workflow.compile(checkpointer=memory, interrupt_before=["critic"])
