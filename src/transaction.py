"""Transaction management for tracking income and expenses."""

from datetime import datetime
from enum import Enum
from typing import Optional


class TransactionType(Enum):
    """Types of financial transactions."""
    INCOME = "income"
    EXPENSE = "expense"


class Transaction:
    """Represents a financial transaction."""
    
    def __init__(
        self,
        amount: float,
        category: str,
        transaction_type: TransactionType,
        description: str = "",
        date: Optional[datetime] = None
    ):
        """
        Initialize a transaction.
        
        Args:
            amount: Transaction amount
            category: Transaction category
            transaction_type: Type of transaction (INCOME or EXPENSE)
            description: Optional description
            date: Transaction date (defaults to current date)
        """
        self.amount = abs(amount)
        self.category = category
        self.transaction_type = transaction_type
        self.description = description
        self.date = date or datetime.now()
        
    def to_dict(self) -> dict:
        """Convert transaction to dictionary."""
        return {
            'date': self.date.strftime('%Y-%m-%d %H:%M:%S'),
            'type': self.transaction_type.value,
            'category': self.category,
            'amount': self.amount,
            'description': self.description
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'Transaction':
        """Create transaction from dictionary."""
        return cls(
            amount=float(data['amount']),
            category=data['category'],
            transaction_type=TransactionType(data['type']),
            description=data.get('description', ''),
            date=datetime.strptime(data['date'], '%Y-%m-%d %H:%M:%S')
        )
    
    def __repr__(self) -> str:
        return f"Transaction({self.date.date()}, {self.transaction_type.value}, {self.category}, ${self.amount:.2f})"
