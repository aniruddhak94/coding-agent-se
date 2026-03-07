"""Service for interacting with Google Gemini AI."""
import os
from typing import AsyncGenerator, Optional
from dotenv import load_dotenv
import google.generativeai as genai

# Load variables from .env file into environment
load_dotenv()

# Fetch key from environment
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Configure Gemini
_api_configured = False
if GEMINI_API_KEY and GEMINI_API_KEY != "your-gemini-api-key":
    genai.configure(api_key=GEMINI_API_KEY)
    _api_configured = True
    print(f"Gemini API configured successfully")
else:
    print(f"Gemini API NOT configured - key missing or placeholder")


class GeminiService:
    """Service for interacting with Google Gemini AI."""
    
    SYSTEM_PROMPT = """You are an expert coding assistant called ICA (Intelligent Coding Agent).
You help developers with:
- Writing clean, efficient, idiomatic code
- Explaining code concepts and logic
- Debugging errors and suggesting fixes
- Best practices and optimization

When generating code:
- Always use proper syntax highlighting with language identifiers
- Include helpful comments
- Follow language-specific conventions
- Handle edge cases appropriately

When explaining code:
- Break down complex logic step by step
- Highlight important patterns and concepts
- Point out potential issues or improvements

Support languages: Python, JavaScript, TypeScript, C++, Java, and more.

Format responses using Markdown with proper code blocks."""

    def __init__(self):
        if _api_configured:
            try:
                self.model = genai.GenerativeModel(
                    model_name="gemini-3-flash-preview",
                )
                print("Gemini model initialized successfully")
            except Exception as e:
                print(f"Failed to initialize Gemini model: {e}")
                self.model = None
        else:
            self.model = None
            print("Gemini model not initialized - API not configured")
    
    async def generate_response(
        self,
        message: str,
        chat_history: Optional[list[dict]] = None,
        context: Optional[str] = None,
    ) -> str:
        """Generate a response from the AI model with optional RAG context."""
        if self.model is None:
            return "⚠️ **Gemini API not configured**\n\nTo enable AI responses, please add your Gemini API key to the `.env` file:\n\n```\nGEMINI_API_KEY=your-actual-api-key-here\n```\n\nYou can get an API key from [Google AI Studio](https://aistudio.google.com/)."
        
        try:
            # Build the prompt with optional context
            if context:
                full_message = f"""{self.SYSTEM_PROMPT}

The following code snippets from the repository are relevant to the user's question:

{context}

Use this context to provide accurate, repository-aware answers. Reference specific file paths and line numbers when helpful.

User: {message}"""
            else:
                full_message = f"{self.SYSTEM_PROMPT}\n\nUser: {message}"
            
            # Build conversation history
            history = []
            if chat_history:
                for msg in chat_history:
                    role = "user" if msg["role"] == "user" else "model"
                    history.append({"role": role, "parts": [msg["content"]]})
            
            # Start chat session
            chat = self.model.start_chat(history=history)
            
            # Generate response
            response = await chat.send_message_async(full_message)
            return response.text
        except Exception as e:
            return f"I apologize, but I encountered an error: {str(e)}\n\nPlease check if the Gemini API key is configured correctly."
    
    async def stream_response(
        self,
        message: str,
        chat_history: Optional[list[dict]] = None,
        context: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream a response from the AI model with optional RAG context."""
        if self.model is None:
            yield "⚠️ **Gemini API not configured**\n\nTo enable AI responses, please add your Gemini API key to the `.env` file.\n\nGet your key from [Google AI Studio](https://aistudio.google.com/)."
            return
        
        try:
            # Build the prompt with optional context
            if context:
                full_message = f"""{self.SYSTEM_PROMPT}

The following code snippets from the repository are relevant to the user's question:

{context}

Use this context to provide accurate, repository-aware answers. Reference specific file paths and line numbers when helpful.

User: {message}"""
            else:
                full_message = f"{self.SYSTEM_PROMPT}\n\nUser: {message}"
            
            # Build conversation history
            history = []
            if chat_history:
                for msg in chat_history:
                    role = "user" if msg["role"] == "user" else "model"
                    history.append({"role": role, "parts": [msg["content"]]})
            
            # Start chat session
            chat = self.model.start_chat(history=history)
            
            # Generate streaming response
            response = await chat.send_message_async(full_message, stream=True)
            
            async for chunk in response:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            yield f"Error: {str(e)}"
    
    async def generate_code(
        self,
        task: str,
        language: str,
        context: Optional[str] = None,
    ) -> str:
        """Generate code for a specific task."""
        prompt = f"""Generate {language} code for the following task:

**Task:** {task}

{f'**Context:** {context}' if context else ''}

Provide:
1. Complete, working code
2. Brief explanation of the approach
3. Usage example if applicable"""
        
        return await self.generate_response(prompt)
    
    async def explain_code(self, code: str, language: str) -> str:
        """Explain a piece of code."""
        prompt = f"""Explain the following {language} code in detail:

```{language}
{code}
```

Provide:
1. Overall purpose and functionality
2. Line-by-line or section-by-section breakdown
3. Key concepts and patterns used
4. Potential improvements or issues"""
        
        return await self.generate_response(prompt)
    
    async def debug_code(
        self,
        code: str,
        error: str,
        language: str,
    ) -> str:
        """Debug code and suggest fixes."""
        prompt = f"""Debug the following {language} code that produces this error:

**Error:**
```
{error}
```

**Code:**
```{language}
{code}
```

Provide:
1. Root cause of the error
2. Fixed code with the issue resolved
3. Explanation of what was wrong
4. Tips to prevent similar issues"""
        
        return await self.generate_response(prompt)


# Singleton instance
_gemini_service: Optional[GeminiService] = None


def get_gemini_service() -> GeminiService:
    """Get or create the Gemini service instance."""
    global _gemini_service
    if _gemini_service is None:
        _gemini_service = GeminiService()
    return _gemini_service
