import logging
from logging.handlers import RotatingFileHandler
import json
from datetime import datetime
from typing import Dict, Any
from config import LOGGING_CONFIG

def setup_logger() -> logging.Logger:
    """Configure and return a logger instance with rotating file handler"""
    logger = logging.getLogger('raydium_listener')
    logger.setLevel(logging.INFO)
    
    # Create rotating file handler
    file_handler = RotatingFileHandler(
        LOGGING_CONFIG['message_log_file'],
        maxBytes=LOGGING_CONFIG['max_log_size_mb'] * 1024 * 1024,
        backupCount=LOGGING_CONFIG['backup_count']
    )
    
    # Create console handler
    console_handler = logging.StreamHandler()
    
    # Create formatters and add them to handlers
    file_formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_formatter = logging.Formatter('%(message)s')
    
    file_handler.setFormatter(file_formatter)
    console_handler.setFormatter(console_formatter)
    
    # Add handlers to logger
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

def log_message(logger: logging.Logger, message_type: str, data: Dict[str, Any], console_output: bool = True) -> None:
    """Log a message with timestamp and formatted data
    
    Args:
        logger: The logger instance to use
        message_type: Type of message being logged
        data: Dictionary containing the message data
        console_output: Whether to output to console (default: True)
    """
    timestamp = datetime.now().isoformat()
    log_entry = {
        'timestamp': timestamp,
        'type': message_type,
        'data': data
    }
    
    # Log to file as JSON
    logger.info(json.dumps(log_entry))
    
    # Only output to console if requested
    if console_output:
        formatted_message = f"[{timestamp}] {message_type}: {json.dumps(data, indent=2)}"
        print(formatted_message) 