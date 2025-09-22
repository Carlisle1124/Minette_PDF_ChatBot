#!/usr/bin/env python3
"""
Simple test script to verify the streaming endpoint works correctly.
This script tests the backend streaming functionality directly.
"""

import requests
import json
import time

BASE_URL = "http://localhost:8000"

def test_streaming_chat():
    """Test the streaming chat endpoint"""
    print("Testing streaming chat endpoint...")
    
    # Test message
    test_message = "What is artificial intelligence?"
    
    payload = {
        "message": test_message
    }
    
    print(f"Sending question: {test_message}")
    print("=" * 50)
    
    try:
        response = requests.post(
            f"{BASE_URL}/chat/stream",
            json=payload,
            stream=True,
            timeout=60
        )
        
        if response.status_code != 200:
            print(f"Error: HTTP {response.status_code}")
            print(response.text)
            return
        
        print("Streaming response:")
        print("-" * 30)
        
        full_content = ""
        contexts_received = False
        
        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')
                if line_str.startswith('data: '):
                    try:
                        data = json.loads(line_str[6:])
                        
                        if data['type'] == 'contexts':
                            print(f"📚 Received {len(data['data'])} context chunks")
                            contexts_received = True
                            
                        elif data['type'] == 'content':
                            content = data['data']
                            full_content += content
                            print(content, end='', flush=True)
                            time.sleep(0.05)  # Small delay to see streaming effect
                            
                        elif data['type'] == 'done':
                            print(f"\n\n✅ Streaming complete!")
                            print(f"Full response length: {len(full_content)} characters")
                            break
                            
                        elif data['type'] == 'error':
                            print(f"\n❌ Error: {data['data']['message']}")
                            break
                            
                    except json.JSONDecodeError as e:
                        print(f"Failed to parse: {line_str}")
        
        print("\n" + "=" * 50)
        print("Test completed successfully!" if contexts_received and full_content else "Test may have issues")
        
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
        print("Make sure the backend is running on http://localhost:8000")

def test_health():
    """Test if backend is running"""
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code == 200:
            print("✅ Backend is running and healthy")
            return True
        else:
            print(f"❌ Backend health check failed: {response.status_code}")
            return False
    except requests.exceptions.RequestException:
        print("❌ Backend is not running or not accessible")
        return False

if __name__ == "__main__":
    print("🧪 Testing streaming functionality")
    print("=" * 50)
    
    if test_health():
        print()
        test_streaming_chat()
    else:
        print("\nPlease start the backend first:")
        print("cd backend")
        print("python main.py")