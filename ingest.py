import os
import requests
from bs4 import BeautifulSoup
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_chroma import Chroma
from dotenv import load_dotenv

load_dotenv()

# Build the RAG Ingestion Pipeline

def fetch_documentation(url):
    """Fetches HTML content from a given URL."""
    try:
        print(f"Fetching {url}...")
        response = requests.get(url)
        response.raise_for_status()
        return response.text
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def parse_html_to_markdown(html_content):
    """Converts HTML to clean text (approximate markdown) using BeautifulSoup."""
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Remove script and style elements
    for script_or_style in soup(['script', 'style', 'nav', 'footer', 'header']):
        script_or_style.decompose()
        
    text = soup.get_text(separator='\n')
    
    # Clean up blank lines
    lines = (line.strip() for line in text.splitlines())
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    text = '\n'.join(chunk for chunk in chunks if chunk)
    
    return text

def build_vector_store(urls, persist_directory="./chroma_db"):
    """Fetches docs, chunks them, and stores in ChromaDB."""
    all_text = ""
    for url in urls:
        html = fetch_documentation(url)
        if html:
            text = parse_html_to_markdown(html)
            all_text += text + "\n\n"
            
    if not all_text:
        print("No content fetched. Exiting.")
        return None

    print("Chunking text...")
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len
    )
    chunks = text_splitter.split_text(all_text)
    
    print(f"Created {len(chunks)} chunks.")
    print("Embedding and storing in ChromaDB...")
    
    embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-2")
    
    vectorstore_kwargs = {"embedding": embeddings}
    chroma_host = os.getenv("CHROMA_SERVER_HOST")
    if chroma_host:
        vectorstore_kwargs["host"] = chroma_host
        vectorstore_kwargs["port"] = int(os.getenv("CHROMA_SERVER_PORT", "8000"))
    else:
        vectorstore_kwargs["persist_directory"] = persist_directory

    vectorstore = Chroma.from_texts(
        texts=chunks,
        **vectorstore_kwargs
    )
    
    print(f"Vector store successfully built and saved to {persist_directory}")
    return vectorstore

if __name__ == "__main__":
    # Scrape some hypothetical API docs
    example_urls = [
        "https://docs.stripe.com/api" 
    ]
    build_vector_store(example_urls)
