import os
import subprocess
import shutil
import venv
import platform

# Create the Execution Sandbox

EXECUTION_DIR = "./temp_execution"
TEMP_FILE_NAME = "temp_script.py"

def setup_sandbox() -> str:
    """Creates the temporary execution directory and returns the path to the virtual env's python executable."""
    if not os.path.exists(EXECUTION_DIR):
        os.makedirs(EXECUTION_DIR)
        
    venv_dir = os.path.join(EXECUTION_DIR, "venv_sandbox")
    
    # Create venv if it doesn't exist
    if not os.path.exists(venv_dir):
        print(f"Creating isolated virtual environment in {venv_dir}...")
        venv.create(venv_dir, with_pip=True)
        
    if platform.system() == "Windows":
        python_executable = os.path.join(venv_dir, "Scripts", "python.exe")
    else:
        python_executable = os.path.join(venv_dir, "bin", "python")
        
    return python_executable

def cleanup_sandbox():
    """Cleans up the execution directory."""
    if os.path.exists(EXECUTION_DIR):
        shutil.rmtree(EXECUTION_DIR)

def install_dependencies(python_executable: str, dependencies: list[str]) -> bool:
    """Installs required pip dependencies in the sandbox venv."""
    if not dependencies:
        return True
        
    print(f"Installing dependencies in sandbox: {', '.join(dependencies)}")
    try:
        result = subprocess.run(
            [python_executable, "-m", "pip", "install"] + dependencies,
            capture_output=True,
            text=True,
            timeout=120
        )
        if result.returncode != 0:
            print(f"Failed to install dependencies: {result.stderr}")
            return False
        return True
    except Exception as e:
        print(f"Error during pip install: {e}")
        return False

def run_code_sandbox(code: str, dependencies: list[str] = None, timeout_seconds: int = 15) -> dict:
    """
    Saves and runs the generated Python code in an isolated sandboxed venv.
    """
    if dependencies is None:
        dependencies = []
        
    python_executable = setup_sandbox()
    
    # Install requested packages
    success = install_dependencies(python_executable, dependencies)
    if not success:
        return {
            "success": False,
            "stdout": "",
            "stderr": "Failed to install required dependencies in the sandbox.",
            "error_type": "DependencyError"
        }

    file_path = os.path.join(EXECUTION_DIR, TEMP_FILE_NAME)
    
    # Basic Security
    dangerous_keywords = ["shutil.rmtree", "os.remove", "os.rmdir"]
    for keyword in dangerous_keywords:
        if keyword in code:
            return {
                "success": False,
                "stdout": "",
                "stderr": f"Security Error: Code contains prohibited keyword '{keyword}'.",
                "error_type": "SecurityError"
            }

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(code)
            
        print(f"Executing script (timeout={timeout_seconds}s)...")
        result = subprocess.run(
            [python_executable, TEMP_FILE_NAME],
            cwd=EXECUTION_DIR,
            capture_output=True,
            text=True,
            timeout=timeout_seconds
        )
        
        is_success = result.returncode == 0
        return {
            "success": is_success,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "error_type": "ExecutionError" if not is_success else None
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Execution timed out after {timeout_seconds} seconds.",
            "error_type": "TimeoutError"
        }
    except Exception as e:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Unexpected sandbox error: {str(e)}",
            "error_type": "SystemError"
        }
