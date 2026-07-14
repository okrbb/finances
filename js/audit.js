import { addDoc, collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export async function logAuditEvent(db, event) {
    if (!db || !event?.uid) return;

    try {
        await addDoc(collection(db, 'auditLogs'), {
            uid: event.uid,
            action: event.action || 'update',
            entityType: event.entityType || 'system',
            entityId: event.entityId || '',
            batchId: event.batchId || '',
            year: event.year || null,
            actor: event.actor || '',
            message: event.message || '',
            metadata: event.metadata || {},
            createdAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Audit log error:', error);
    }
}

export async function fetchRecentAuditEvents(db, uid, maxItems = 20) {
    if (!db || !uid) return [];

    try {
        const snapshot = await getDocs(query(collection(db, 'auditLogs'), where('uid', '==', uid)));
        return snapshot.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
            .slice(0, maxItems);
    } catch (error) {
        if (error?.code === 'permission-denied') {
            return [];
        }
        console.error('Fetch audit logs error:', error);
        return [];
    }
}

export function formatAuditTimestamp(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('sk-SK');
}