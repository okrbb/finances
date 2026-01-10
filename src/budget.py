"""Budget management and tracking."""

from typing import Dict, List
from datetime import datetime


class Budget:
    """Manages budgets for different categories."""
    
    def __init__(self):
        """Initialize budget manager."""
        self.budgets: Dict[str, float] = {}
    
    def set_budget(self, category: str, amount: float):
        """
        Set budget for a category.
        
        Args:
            category: Category name
            amount: Budget amount
        """
        if amount < 0:
            raise ValueError("Budget amount must be positive")
        self.budgets[category] = amount
    
    def get_budget(self, category: str) -> float:
        """
        Get budget for a category.
        
        Args:
            category: Category name
            
        Returns:
            Budget amount (0 if not set)
        """
        return self.budgets.get(category, 0.0)
    
    def remove_budget(self, category: str):
        """
        Remove budget for a category.
        
        Args:
            category: Category name
        """
        if category in self.budgets:
            del self.budgets[category]
    
    def get_all_budgets(self) -> Dict[str, float]:
        """Get all budgets."""
        return self.budgets.copy()
    
    def check_budget_status(self, category: str, spent: float) -> dict:
        """
        Check budget status for a category.
        
        Args:
            category: Category name
            spent: Amount spent
            
        Returns:
            Dictionary with budget status information
        """
        budget = self.get_budget(category)
        if budget == 0:
            return {
                'category': category,
                'budget': 0,
                'spent': spent,
                'remaining': 0,
                'percentage': 0,
                'status': 'no_budget'
            }
        
        remaining = budget - spent
        percentage = (spent / budget) * 100
        
        if percentage >= 100:
            status = 'exceeded'
        elif percentage >= 80:
            status = 'warning'
        else:
            status = 'ok'
        
        return {
            'category': category,
            'budget': budget,
            'spent': spent,
            'remaining': remaining,
            'percentage': percentage,
            'status': status
        }
