"""Report generation and financial analysis."""

from typing import List, Dict
from datetime import datetime, timedelta
from collections import defaultdict
from transaction import Transaction, TransactionType


class Report:
    """Generates financial reports and analysis."""
    
    def __init__(self, transactions: List[Transaction]):
        """
        Initialize report generator.
        
        Args:
            transactions: List of transactions to analyze
        """
        self.transactions = transactions
    
    def get_summary(self, start_date: datetime = None, end_date: datetime = None) -> Dict:
        """
        Get financial summary for a period.
        
        Args:
            start_date: Start date for analysis
            end_date: End date for analysis
            
        Returns:
            Dictionary with summary information
        """
        filtered_transactions = self._filter_by_date(start_date, end_date)
        
        total_income = sum(
            t.amount for t in filtered_transactions 
            if t.transaction_type == TransactionType.INCOME
        )
        total_expenses = sum(
            t.amount for t in filtered_transactions 
            if t.transaction_type == TransactionType.EXPENSE
        )
        
        return {
            'total_income': total_income,
            'total_expenses': total_expenses,
            'net_balance': total_income - total_expenses,
            'transaction_count': len(filtered_transactions)
        }
    
    def get_category_breakdown(self, transaction_type: TransactionType = None) -> Dict[str, float]:
        """
        Get breakdown by category.
        
        Args:
            transaction_type: Filter by transaction type (optional)
            
        Returns:
            Dictionary mapping categories to amounts
        """
        breakdown = defaultdict(float)
        
        for transaction in self.transactions:
            if transaction_type is None or transaction.transaction_type == transaction_type:
                breakdown[transaction.category] += transaction.amount
        
        return dict(breakdown)
    
    def get_monthly_trend(self, months: int = 6) -> Dict[str, Dict]:
        """
        Get monthly trend data.
        
        Args:
            months: Number of months to include
            
        Returns:
            Dictionary with monthly data
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30 * months)
        
        monthly_data = defaultdict(lambda: {'income': 0, 'expenses': 0})
        
        for transaction in self.transactions:
            if start_date <= transaction.date <= end_date:
                month_key = transaction.date.strftime('%Y-%m')
                
                if transaction.transaction_type == TransactionType.INCOME:
                    monthly_data[month_key]['income'] += transaction.amount
                else:
                    monthly_data[month_key]['expenses'] += transaction.amount
        
        return dict(monthly_data)
    
    def _filter_by_date(
        self, 
        start_date: datetime = None, 
        end_date: datetime = None
    ) -> List[Transaction]:
        """Filter transactions by date range."""
        filtered = self.transactions
        
        if start_date:
            filtered = [t for t in filtered if t.date >= start_date]
        if end_date:
            filtered = [t for t in filtered if t.date <= end_date]
        
        return filtered
