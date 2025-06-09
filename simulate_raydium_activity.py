import requests
import time
import random

def simulate_raydium_activity():
    """Simulate some activity to test health monitoring"""
    print("🔧 Simulating Raydium activity...")
    
    # Make some requests to trigger activity
    for i in range(5):
        try:
            # Make a simple request to the server
            response = requests.get('http://localhost:5001/', timeout=5)
            print(f"✅ Request {i+1}: {response.status_code}")
        except Exception as e:
            print(f"❌ Request {i+1} failed: {e}")
        
        time.sleep(random.uniform(1, 3))
    
    print("🎯 Simulation complete!")

if __name__ == "__main__":
    simulate_raydium_activity() 