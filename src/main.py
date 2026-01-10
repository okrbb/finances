"""Main application entry point."""

import sys
from datetime import datetime
from transaction import Transaction, TransactionType
from budget import Budget
from storage import Storage
from report import Report


class FinanceTracker:
    """Main finance tracker application."""
    
    def __init__(self):
        """Initialize the finance tracker."""
        self.storage = Storage()
        self.transactions = self.storage.load_transactions()
        self.budget = Budget()
    
    def add_transaction(
        self, 
        amount: float, 
        category: str, 
        transaction_type: TransactionType,
        description: str = ""
    ):
        """Add a new transaction."""
        transaction = Transaction(amount, category, transaction_type, description)
        self.transactions.append(transaction)
        self.storage.append_transaction(transaction)
        print(f"✓ Transaction added: {transaction}")
    
    def show_summary(self):
        """Display financial summary."""
        report = Report(self.transactions)
        summary = report.get_summary()
        
        print("\n" + "="*50)
        print("FINANCIAL SUMMARY")
        print("="*50)
        print(f"Total Income:    ${summary['total_income']:,.2f}")
        print(f"Total Expenses:  ${summary['total_expenses']:,.2f}")
        print(f"Net Balance:     ${summary['net_balance']:,.2f}")
        print(f"Transactions:    {summary['transaction_count']}")
        print("="*50 + "\n")
    
    def show_category_breakdown(self):
        """Display category breakdown."""
        report = Report(self.transactions)
        
        print("\n" + "="*50)
        print("EXPENSE BREAKDOWN BY CATEGORY")
        print("="*50)
        
        expenses = report.get_category_breakdown(TransactionType.EXPENSE)
        if expenses:
            for category, amount in sorted(expenses.items(), key=lambda x: x[1], reverse=True):
                print(f"{category:20s} ${amount:,.2f}")
        else:
            print("No expenses recorded.")
        print("="*50 + "\n")
    
    def run_demo(self):
        """Run a demonstration with sample data."""
        print("\n🎯 Personal Finance Tracker - Demo Mode\n")
        
        # Add sample transactions
        print("Adding sample transactions...")
        self.add_transaction(3000, "Salary", TransactionType.INCOME, "Monthly salary")
        self.add_transaction(500, "Freelance", TransactionType.INCOME, "Side project")
        self.add_transaction(1200, "Rent", TransactionType.EXPENSE, "Monthly rent")
        self.add_transaction(300, "Groceries", TransactionType.EXPENSE, "Food shopping")
        self.add_transaction(150, "Utilities", TransactionType.EXPENSE, "Electric & water")
        self.add_transaction(80, "Entertainment", TransactionType.EXPENSE, "Movies & dining")
        
        # Show reports
        self.show_summary()
        self.show_category_breakdown()
        
        # Set and check budgets
        print("\nSetting monthly budgets...")
        self.budget.set_budget("Groceries", 400)
        self.budget.set_budget("Entertainment", 200)
        self.budget.set_budget("Utilities", 150)
        
        print("\nBudget Status:")
        print("="*50)
        report = Report(self.transactions)
        expenses = report.get_category_breakdown(TransactionType.EXPENSE)
        
        for category, spent in expenses.items():
            status = self.budget.check_budget_status(category, spent)
            if status['status'] != 'no_budget':
                symbol = "✓" if status['status'] == 'ok' else "⚠" if status['status'] == 'warning' else "✗"
                print(f"{symbol} {category:20s} ${spent:,.2f} / ${status['budget']:,.2f} ({status['percentage']:.0f}%)")
        print("="*50 + "\n")


def main():
    """Main entry point."""
    tracker = FinanceTracker()
    
    print("="*50)
    print("       PERSONAL FINANCE TRACKER")
    print("="*50)
    
    if len(tracker.transactions) == 0:
        print("\nNo existing transactions found.")
        print("Running demo mode with sample data...\n")
        tracker.run_demo()
    else:
        print(f"\nLoaded {len(tracker.transactions)} existing transactions.\n")
        tracker.show_summary()
        tracker.show_category_breakdown()
    
    print("\n💡 Tip: Modify src/main.py to add your own transactions!")
    print("   Use tracker.add_transaction(amount, category, type, description)\n")


if __name__ == "__main__":
    main()
