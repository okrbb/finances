"""Data storage and persistence."""

import csv
import os
from typing import List
from datetime import datetime
from transaction import Transaction, TransactionType


class Storage:
    """Handles data persistence for transactions."""
    
    def __init__(self, data_dir: str = "data"):
        """
        Initialize storage.
        
        Args:
            data_dir: Directory for data files
        """
        self.data_dir = data_dir
        self.transactions_file = os.path.join(data_dir, "transactions.csv")
        self._ensure_data_dir()
    
    def _ensure_data_dir(self):
        """Ensure data directory exists."""
        os.makedirs(self.data_dir, exist_ok=True)
    
    def save_transactions(self, transactions: List[Transaction]):
        """
        Save transactions to CSV file.
        
        Args:
            transactions: List of transactions to save
        """
        with open(self.transactions_file, 'w', newline='', encoding='utf-8') as f:
            if not transactions:
                return
            
            fieldnames = ['date', 'type', 'category', 'amount', 'description']
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            
            for transaction in transactions:
                writer.writerow(transaction.to_dict())
    
    def load_transactions(self) -> List[Transaction]:
        """
        Load transactions from CSV file.
        
        Returns:
            List of transactions
        """
        if not os.path.exists(self.transactions_file):
            return []
        
        transactions = []
        with open(self.transactions_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    transaction = Transaction.from_dict(row)
                    transactions.append(transaction)
                except Exception as e:
                    print(f"Error loading transaction: {e}")
        
        return transactions
    
    def append_transaction(self, transaction: Transaction):
        """
        Append a single transaction to the file.
        
        Args:
            transaction: Transaction to append
        """
        file_exists = os.path.exists(self.transactions_file)
        
        with open(self.transactions_file, 'a', newline='', encoding='utf-8') as f:
            fieldnames = ['date', 'type', 'category', 'amount', 'description']
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            
            if not file_exists:
                writer.writeheader()
            
            writer.writerow(transaction.to_dict())
