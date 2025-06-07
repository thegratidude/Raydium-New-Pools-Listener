from setuptools import setup, find_packages

setup(
    name="raydium-trading",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "solana",
        "solders",
        "python-dotenv",
        "python-socketio[client]==5.8.0",
        "colorama==0.4.6",
        "typing-extensions==4.9.0",
        "python-engineio==4.8.0",
        "websockets==12.0",
        "aiohttp==3.9.3"
    ],
    python_requires=">=3.7",
) 