// js/notifications.js

export function showToast(message, type = 'success') {
    // 1. Skontrolovať alebo vytvoriť kontajner
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    // 2. Vybrať ikonu podľa typu
    let icon = 'fa-check-circle';
    if (type === 'danger') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    // 3. Vytvoriť samotný toast
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // 4. Automatické odstránenie po 4 sekundách
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}