// frontend/src/pages/dashboards/AdminDashboard.js
//
// Service Connect administrator console.
// Every number and table comes from the admin API (real database data). All
// requests send the admin JWT in x-auth-token and the backend re-checks the
// administrator role on every call.

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { API_BASE_URL, DARK_CYAN_CLASS, DARK_CYAN_HOVER_CLASS } from '../utils/helpers';
import { Spinner, ErrorMessage, SuccessMessage } from '../../components/shared/UI';
import { AdminLoginPage } from '../../components/auth/AuthForms';

const apiRequest = async (path, { token, method = 'GET', body } = {}) => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            'x-auth-token': token,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || `Request failed (HTTP ${response.status}).`);
        error.status = response.status;
        throw error;
    }
    return data;
};

const STATUS_STYLES = {
    active: 'bg-green-100 text-green-800',
    approved: 'bg-green-100 text-green-800',
    suspended: 'bg-red-100 text-red-800',
    rejected: 'bg-red-100 text-red-800',
    deactivated: 'bg-gray-200 text-gray-700',
    pending: 'bg-yellow-100 text-yellow-800',
    pending_verification: 'bg-yellow-100 text-yellow-800',
    under_review: 'bg-blue-100 text-blue-800',
    pending_provider: 'bg-yellow-100 text-yellow-800',
    awaiting_customer_confirmation: 'bg-purple-100 text-purple-800',
    accepted: 'bg-blue-100 text-blue-800',
    completed: 'bg-orange-100 text-orange-800',
    closed: 'bg-green-100 text-green-800',
};

const Badge = ({ value }) => (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[value] || 'bg-gray-100 text-gray-700'}`}>
        {String(value || 'unknown').replace(/_/g, ' ')}
    </span>
);

const fmtDate = (value) => (value ? new Date(value).toLocaleString() : '—');
const fmtDay = (value) => (value ? new Date(value).toLocaleDateString() : '—');
const fmtMoney = (value) => (value === null || value === undefined ? '—' : `₹${Number(value).toFixed(2)}`);

const Modal = ({ title, onClose, children, wide = false }) => (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
        <div className={`bg-white rounded-xl shadow-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} my-8`}>
            <div className="flex items-start justify-between border-b px-6 py-4">
                <h2 className="text-lg font-bold text-slate-800">{title}</h2>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none" aria-label="Close">×</button>
            </div>
            <div className="p-6">{children}</div>
        </div>
    </div>
);

const ActionDialog = ({ title, message, confirmLabel = 'Confirm', requireReason = false, busy = false, onCancel, onConfirm }) => {
    const [reason, setReason] = useState('');
    return (
        <Modal title={title} onClose={onCancel}>
            <p className="text-sm text-gray-700 mb-4">{message}</p>
            {requireReason && (
                <div className="mb-4">
                    <label htmlFor="action-reason" className="block text-sm font-semibold text-gray-700 mb-1">
                        Reason (required, stored in the audit log)
                    </label>
                    <textarea id="action-reason" rows="3" value={reason} onChange={(e) => setReason(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder="Explain why this action is necessary..." />
                </div>
            )}
            <div className="flex justify-end gap-3">
                <button onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700">Cancel</button>
                <button onClick={() => onConfirm(reason)} disabled={busy || (requireReason && !reason.trim())}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:bg-gray-400">
                    {busy ? 'Working…' : confirmLabel}
                </button>
            </div>
        </Modal>
    );
};

const Pager = ({ meta, onChange }) => {
    if (!meta || meta.total === 0) return null;
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm">
            <p className="text-gray-600">Page {meta.page} of {Math.max(1, meta.total_pages)} · {meta.total} record{meta.total === 1 ? '' : 's'}</p>
            <div className="flex gap-2">
                <button onClick={() => onChange(meta.page - 1)} disabled={!meta.has_previous} className="px-3 py-1.5 rounded-lg border border-gray-300 font-semibold disabled:opacity-40">Previous</button>
                <button onClick={() => onChange(meta.page + 1)} disabled={!meta.has_next} className="px-3 py-1.5 rounded-lg border border-gray-300 font-semibold disabled:opacity-40">Next</button>
            </div>
        </div>
    );
};

const useAdminList = (endpoint, queryString, token) => {
    const [state, setState] = useState({ data: [], pagination: null, loading: true, error: '' });
    const load = useCallback(async () => {
        if (!token) return;
        setState((previous) => ({ ...previous, loading: true, error: '' }));
        try {
            const body = await apiRequest(`${endpoint}?${queryString}`, { token });
            setState({ data: body.data || [], pagination: body.pagination || null, loading: false, error: '' });
        } catch (error) {
            setState({ data: [], pagination: null, loading: false, error: error.message });
        }
    }, [endpoint, queryString, token]);
    useEffect(() => { load(); }, [load]);
    return { ...state, reload: load };
};

const StatCard = ({ label, value, tone = 'bg-slate-800' }) => (
    <div className={`${tone} text-white rounded-xl shadow p-4`}>
        <p className="text-xs font-medium opacity-80 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-extrabold mt-1">{value ?? '—'}</p>
    </div>
);

const Table = ({ headers, children, emptyMessage = 'No records found.' }) => (
    <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <table className="min-w-full bg-white text-sm">
            <thead className="bg-slate-50">
                <tr>{headers.map((header) => <th key={header} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase border-b">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {React.Children.count(children) === 0 ? (
                    <tr><td colSpan={headers.length} className="px-4 py-10 text-center text-gray-500">{emptyMessage}</td></tr>
                ) : children}
            </tbody>
        </table>
    </div>
);

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

const OverviewTab = ({ token }) => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        apiRequest('/admin/dashboard/stats', { token })
            .then((body) => { if (!cancelled) setStats(body); })
            .catch((err) => { if (!cancelled) setError(err.message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [token]);

    if (loading) return <Spinner />;
    if (error) return <ErrorMessage message={error} />;
    if (!stats) return null;

    const cards = [
        ['Total users', stats.users.total_users, 'bg-slate-800'],
        ['Customers', stats.users.total_customers, 'bg-blue-700'],
        ['Providers', stats.users.total_providers, 'bg-cyan-700'],
        ['Approved providers', stats.providers.approved_providers, 'bg-green-700'],
        ['Pending providers', stats.providers.pending_providers, 'bg-yellow-600'],
        ['Under review', stats.providers.under_review_providers, 'bg-blue-700'],
        ['Rejected providers', stats.providers.rejected_providers, 'bg-red-700'],
        ['Suspended providers', stats.providers.suspended_providers, 'bg-red-800'],
        ['Services', stats.services.total_services, 'bg-slate-800'],
        ['Active services', stats.services.active_services, 'bg-green-700'],
        ['Bookings', stats.bookings.total_bookings, 'bg-slate-800'],
        ['Pending bookings', stats.bookings.pending_bookings, 'bg-yellow-600'],
        ['Completed bookings', stats.bookings.completed_bookings, 'bg-blue-700'],
        ['Cancelled bookings', stats.bookings.cancelled_bookings, 'bg-red-700'],
        ['Reviews', stats.reviews.total_reviews, 'bg-cyan-700'],
        ['Open complaints', stats.complaints.unresolved_complaints, 'bg-yellow-700'],
    ];

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-bold text-slate-800">Platform overview</h2>
                <p className="text-sm text-gray-500 mb-4">Live database counts · generated {fmtDate(stats.generated_at)}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-4">
                    {cards.map(([label, value, tone]) => <StatCard key={label} label={label} value={value} tone={tone} />)}
                </div>
            </div>
            <div className="grid lg:grid-cols-3 gap-6">
                <div>
                    <h3 className="text-lg font-bold text-slate-800 mb-3">Recent registrations</h3>
                    <Table headers={['Email', 'Role', 'Registered']} emptyMessage="No registrations yet.">
                        {stats.recent_registrations.map((u) => (
                            <tr key={u.id}><td className="px-4 py-3">{u.email}</td><td className="px-4 py-3"><Badge value={u.role} /></td><td className="px-4 py-3 text-gray-500">{fmtDay(u.created_at)}</td></tr>
                        ))}
                    </Table>
                </div>
                <div>
                    <h3 className="text-lg font-bold text-slate-800 mb-3">Recent bookings</h3>
                    <Table headers={['ID', 'Service', 'Status']} emptyMessage="No bookings yet.">
                        {stats.recent_bookings.map((b) => (
                            <tr key={b.id}><td className="px-4 py-3 font-mono">#{b.id}</td><td className="px-4 py-3">{b.service_name}</td><td className="px-4 py-3"><Badge value={b.booking_status} /></td></tr>
                        ))}
                    </Table>
                </div>
                <div>
                    <h3 className="text-lg font-bold text-slate-800 mb-3">Recent admin activity</h3>
                    <Table headers={['Action', 'Admin', 'When']} emptyMessage="No admin actions logged yet.">
                        {stats.recent_admin_activity.map((entry) => (
                            <tr key={entry.id}><td className="px-4 py-3">{entry.action}</td><td className="px-4 py-3 text-gray-500 text-xs">{entry.admin_email}</td><td className="px-4 py-3 text-gray-500 text-xs">{fmtDay(entry.created_at)}</td></tr>
                        ))}
                    </Table>
                </div>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

const PROVIDER_ACTIONS = {
    approve: { title: 'Approve provider', requireReason: false },
    reject: { title: 'Reject provider', requireReason: true },
    suspend: { title: 'Suspend provider', requireReason: true },
    'request-info': { title: 'Request more information', requireReason: true },
    reactivate: { title: 'Reactivate provider', requireReason: false },
};

const ProviderDetail = ({ id, token, onClose }) => {
    const [detail, setDetail] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        apiRequest(`/admin/providers/${id}`, { token }).then(setDetail).catch((err) => setError(err.message));
    }, [id, token]);

    return (
        <Modal title={`Provider #${id}`} onClose={onClose} wide>
            {error && <ErrorMessage message={error} />}
            {!detail && !error && <Spinner />}
            {detail && (
                <div className="space-y-5 text-sm">
                    <div className="grid sm:grid-cols-2 gap-3">
                        <p><strong>Name:</strong> {detail.provider.display_name}</p>
                        <p><strong>Email:</strong> {detail.provider.email}</p>
                        <p><strong>Status:</strong> <Badge value={detail.provider.verification_status} /></p>
                        <p><strong>Account:</strong> <Badge value={detail.provider.user_status} /></p>
                        <p><strong>Rating:</strong> {Number(detail.provider.average_rating || 0).toFixed(2)} ({detail.provider.review_count})</p>
                        <p><strong>Service radius:</strong> {detail.provider.service_radius_km ?? '—'} km</p>
                        <p><strong>Coordinates:</strong> {detail.provider.location_lat ?? '—'}, {detail.provider.location_lon ?? '—'}</p>
                        <p><strong>Verified at:</strong> {fmtDate(detail.provider.verified_at)}</p>
                    </div>
                    {(detail.provider.rejection_reason || detail.provider.suspended_reason || detail.provider.verification_notes) && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                            {detail.provider.rejection_reason && <p><strong>Rejection:</strong> {detail.provider.rejection_reason}</p>}
                            {detail.provider.suspended_reason && <p><strong>Suspension:</strong> {detail.provider.suspended_reason}</p>}
                            {detail.provider.verification_notes && <p><strong>Notes:</strong> {detail.provider.verification_notes}</p>}
                        </div>
                    )}
                    <div>
                        <h3 className="font-bold text-slate-800 mb-1">Services offered</h3>
                        {detail.services.length === 0 ? <p className="text-gray-500">No services selected.</p> : (
                            <ul className="list-disc list-inside">{detail.services.map((s) => <li key={s.id}>{s.name}{s.is_active ? '' : ' (inactive)'}</li>)}</ul>
                        )}
                    </div>
                    <p><strong>Bookings:</strong> {detail.booking_stats.total_bookings} total · {detail.booking_stats.completed_bookings} completed · {detail.booking_stats.cancelled_bookings} cancelled</p>
                    <div>
                        <h3 className="font-bold text-slate-800 mb-1">Recent reviews</h3>
                        {detail.reviews.length === 0 ? <p className="text-gray-500">No reviews yet.</p> : (
                            <ul className="space-y-2">
                                {detail.reviews.map((r) => (
                                    <li key={r.id} className="border rounded-lg p-2">
                                        <p className="font-semibold">{r.rating}/5 · {r.customer_email} {r.is_hidden ? '(hidden)' : ''}</p>
                                        <p className="text-gray-600">{r.comment || 'No comment.'}</p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </Modal>
    );
};

const ProvidersTab = ({ token }) => {
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [page, setPage] = useState(1);
    const [detailId, setDetailId] = useState(null);
    const [dialog, setDialog] = useState(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');

    const queryString = `page=${page}&limit=15${status ? `&status=${status}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`;
    const { data, pagination, loading, error, reload } = useAdminList('/admin/providers', queryString, token);

    const act = async (reason) => {
        setBusy(true);
        setActionError('');
        try {
            await apiRequest(`/admin/providers/${dialog.provider.id}/${dialog.action}`, {
                token,
                method: 'PATCH',
                body: PROVIDER_ACTIONS[dialog.action].requireReason ? { reason } : {},
            });
            setNotice(`Provider #${dialog.provider.id}: ${dialog.action} applied.`);
            setDialog(null);
            await reload();
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Providers</h2>
                    <p className="text-sm text-gray-500">Pending applications are listed first.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="px-3 py-2 border rounded-lg text-sm">
                        <option value="">All statuses</option>
                        {['pending', 'under_review', 'approved', 'rejected', 'suspended'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                    <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Name or email" className="px-3 py-2 border rounded-lg text-sm" />
                    <button onClick={() => { setSearch(searchInput.trim()); setPage(1); }} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold">Search</button>
                </div>
            </div>

            {notice && <SuccessMessage message={notice} />}
            {actionError && <ErrorMessage message={actionError} />}
            {error && <ErrorMessage message={error} />}
            {loading && <Spinner />}

            {!loading && !error && (
                <>
                    <Table headers={['ID', 'Provider', 'Services', 'Rating', 'Status', 'Actions']}>
                        {data.map((p) => (
                            <tr key={p.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 font-mono">#{p.id}</td>
                                <td className="px-4 py-3">
                                    <button onClick={() => setDetailId(p.id)} className="font-semibold text-cyan-700 hover:underline">{p.display_name}</button>
                                    <p className="text-xs text-gray-500">{p.email}</p>
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-600">{(p.services || []).join(', ') || '—'}</td>
                                <td className="px-4 py-3">{Number(p.average_rating || 0).toFixed(1)} ({p.review_count})</td>
                                <td className="px-4 py-3"><Badge value={p.verification_status} /></td>
                                <td className="px-4 py-3">
                                    <div className="flex flex-wrap gap-1">
                                        <button onClick={() => setDetailId(p.id)} className="text-xs px-2 py-1 border rounded">View</button>
                                        {p.verification_status !== 'approved' && <button onClick={() => setDialog({ provider: p, action: 'approve' })} className="text-xs px-2 py-1 rounded bg-green-600 text-white">Approve</button>}
                                        {p.verification_status !== 'rejected' && <button onClick={() => setDialog({ provider: p, action: 'reject' })} className="text-xs px-2 py-1 rounded bg-red-600 text-white">Reject</button>}
                                        {p.verification_status !== 'suspended' && <button onClick={() => setDialog({ provider: p, action: 'suspend' })} className="text-xs px-2 py-1 rounded bg-orange-600 text-white">Suspend</button>}
                                        <button onClick={() => setDialog({ provider: p, action: 'request-info' })} className="text-xs px-2 py-1 rounded bg-blue-600 text-white">Request info</button>
                                        {(p.verification_status === 'suspended' || p.verification_status === 'rejected') && <button onClick={() => setDialog({ provider: p, action: 'reactivate' })} className="text-xs px-2 py-1 rounded bg-slate-700 text-white">Reactivate</button>}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </Table>
                    <Pager meta={pagination} onChange={setPage} />
                </>
            )}

            {dialog && (
                <ActionDialog
                    title={PROVIDER_ACTIONS[dialog.action].title}
                    message={`${dialog.provider.display_name} (#${dialog.provider.id}) — current status: ${dialog.provider.verification_status}.`}
                    confirmLabel={PROVIDER_ACTIONS[dialog.action].title}
                    requireReason={PROVIDER_ACTIONS[dialog.action].requireReason}
                    busy={busy}
                    onCancel={() => setDialog(null)}
                    onConfirm={act}
                />
            )}
            {detailId && <ProviderDetail id={detailId} token={token} onClose={() => setDetailId(null)} />}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const UsersTab = ({ token }) => {
    const [role, setRole] = useState('');
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [page, setPage] = useState(1);
    const [dialog, setDialog] = useState(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');

    const queryString = `page=${page}&limit=15${role ? `&role=${role}` : ''}${status ? `&status=${status}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`;
    const { data, pagination, loading, error, reload } = useAdminList('/admin/users', queryString, token);

    const act = async (reason) => {
        setBusy(true);
        setActionError('');
        try {
            await apiRequest(`/admin/users/${dialog.user.id}/status`, { token, method: 'PATCH', body: { status: dialog.status, reason } });
            setNotice(`User #${dialog.user.id} set to ${dialog.status}.`);
            setDialog(null);
            await reload();
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Users</h2>
                    <p className="text-sm text-gray-500">Password hashes and OTPs are never returned.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className="px-3 py-2 border rounded-lg text-sm">
                        <option value="">All roles</option><option value="customer">Customer</option><option value="provider">Provider</option><option value="admin">Admin</option>
                    </select>
                    <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="px-3 py-2 border rounded-lg text-sm">
                        <option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deactivated">Deactivated</option>
                    </select>
                    <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Email or name" className="px-3 py-2 border rounded-lg text-sm" />
                    <button onClick={() => { setSearch(searchInput.trim()); setPage(1); }} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold">Search</button>
                </div>
            </div>

            {notice && <SuccessMessage message={notice} />}
            {actionError && <ErrorMessage message={actionError} />}
            {error && <ErrorMessage message={error} />}
            {loading && <Spinner />}

            {!loading && !error && (
                <>
                    <Table headers={['ID', 'Email', 'Name', 'Role', 'Status', 'Verified', 'Change status']}>
                        {data.map((u) => (
                            <tr key={u.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 font-mono">#{u.id}</td>
                                <td className="px-4 py-3">{u.email}</td>
                                <td className="px-4 py-3 text-gray-600">{u.full_name || u.display_name || '—'}</td>
                                <td className="px-4 py-3"><Badge value={u.role} /></td>
                                <td className="px-4 py-3"><Badge value={u.status} /></td>
                                <td className="px-4 py-3 text-gray-500">{u.email_verified_at ? fmtDay(u.email_verified_at) : 'No'}</td>
                                <td className="px-4 py-3">
                                    <select value={u.status} onChange={(e) => setDialog({ user: u, status: e.target.value })} disabled={u.role === 'admin'} className="text-xs border rounded px-2 py-1 disabled:opacity-50">
                                        <option value="active">Activate</option><option value="suspended">Suspend</option><option value="deactivated">Deactivate</option>
                                    </select>
                                </td>
                            </tr>
                        ))}
                    </Table>
                    <Pager meta={pagination} onChange={setPage} />
                </>
            )}

            {dialog && (
                <ActionDialog
                    title="Change account status"
                    message={`${dialog.user.email} (${dialog.user.role}) → ${dialog.status}.`}
                    confirmLabel="Update status"
                    requireReason={dialog.status !== 'active'}
                    busy={busy}
                    onCancel={() => setDialog(null)}
                    onConfirm={act}
                />
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const EMPTY_SERVICE = { name: '', slug: '', description: '', icon_url: '', is_active: true };

const ServicesTab = ({ token }) => {
    const [page, setPage] = useState(1);
    const [form, setForm] = useState(EMPTY_SERVICE);
    const [editingId, setEditingId] = useState(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [formError, setFormError] = useState('');
    const [deactivate, setDeactivate] = useState(null);
    const { data, pagination, loading, error, reload } = useAdminList('/admin/services', `page=${page}&limit=50&include_inactive=true`, token);

    const startEdit = (service) => {
        setEditingId(service.id);
        setForm({ name: service.name, slug: service.slug || '', description: service.description || '', icon_url: service.icon_url || '', is_active: service.is_active });
        setFormError('');
    };

    const save = async (event) => {
        event.preventDefault();
        setBusy(true);
        setFormError('');
        try {
            if (editingId) {
                await apiRequest(`/admin/services/${editingId}`, { token, method: 'PATCH', body: form });
                setNotice(`Service #${editingId} updated.`);
            } else {
                await apiRequest('/admin/services', { token, method: 'POST', body: form });
                setNotice('Service created.');
            }
            setEditingId(null);
            setForm(EMPTY_SERVICE);
            await reload();
        } catch (err) {
            setFormError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const confirmDeactivate = async () => {
        setBusy(true);
        try {
            const result = await apiRequest(`/admin/services/${deactivate.id}`, { token, method: 'DELETE' });
            setNotice(result.message);
            setDeactivate(null);
            await reload();
        } catch (err) {
            setFormError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-800">Service categories</h2>
            <p className="text-sm text-gray-500">Deactivating hides a category from customers while keeping bookings, providers and reviews intact.</p>
            {notice && <SuccessMessage message={notice} />}
            {(error || formError) && <ErrorMessage message={error || formError} />}

            <form onSubmit={save} className="bg-gray-50 border rounded-xl p-4 grid md:grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-gray-600 uppercase">Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="mt-1 w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 uppercase">Slug (optional)</label><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="mt-1 w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div className="md:col-span-2"><label className="block text-xs font-semibold text-gray-600 uppercase">Description</label><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows="2" className="mt-1 w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 uppercase">Icon URL</label><input value={form.icon_url} onChange={(e) => setForm({ ...form, icon_url: e.target.value })} className="mt-1 w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div className="flex items-end gap-3">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
                    <button type="submit" disabled={busy} className={`ml-auto ${DARK_CYAN_CLASS} text-white text-sm font-semibold px-4 py-2 rounded-lg ${DARK_CYAN_HOVER_CLASS} disabled:bg-gray-400`}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Create service'}</button>
                    {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY_SERVICE); }} className="text-sm font-semibold text-gray-600">Cancel</button>}
                </div>
            </form>

            {loading && <Spinner />}
            {!loading && !error && (
                <>
                    <Table headers={['ID', 'Service', 'Slug', 'Providers', 'Approved', 'Bookings', 'Active', 'Actions']}>
                        {data.map((s) => (
                            <tr key={s.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 font-mono">#{s.id}</td>
                                <td className="px-4 py-3">{s.name}</td>
                                <td className="px-4 py-3 text-xs text-gray-500">{s.slug}</td>
                                <td className="px-4 py-3">{s.provider_count}</td>
                                <td className="px-4 py-3">{s.active_provider_count}</td>
                                <td className="px-4 py-3">{s.booking_count}</td>
                                <td className="px-4 py-3"><Badge value={s.is_active ? 'active' : 'deactivated'} /></td>
                                <td className="px-4 py-3">
                                    <div className="flex gap-1">
                                        <button onClick={() => startEdit(s)} className="text-xs px-2 py-1 border rounded">Edit</button>
                                        {s.is_active && <button onClick={() => setDeactivate(s)} className="text-xs px-2 py-1 rounded bg-orange-600 text-white">Deactivate</button>}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </Table>
                    <Pager meta={pagination} onChange={setPage} />
                </>
            )}

            {deactivate && (
                <ActionDialog
                    title="Deactivate service"
                    message={`Deactivate "${deactivate.name}"? ${deactivate.booking_count} booking(s) and ${deactivate.provider_count} provider link(s) are kept.`}
                    confirmLabel="Deactivate"
                    busy={busy}
                    onCancel={() => setDeactivate(null)}
                    onConfirm={confirmDeactivate}
                />
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

const BOOKING_STATUSES = ['pending_provider', 'awaiting_customer_confirmation', 'accepted', 'rejected', 'completed', 'closed'];

const BookingDetail = ({ id, token, onClose }) => {
    const [detail, setDetail] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        apiRequest(`/admin/bookings/${id}`, { token }).then(setDetail).catch((err) => setError(err.message));
    }, [id, token]);

    return (
        <Modal title={`Booking #${id}`} onClose={onClose} wide>
            {error && <ErrorMessage message={error} />}
            {!detail && !error && <Spinner />}
            {detail && (
                <div className="space-y-4 text-sm">
                    <div className="grid sm:grid-cols-2 gap-2">
                        <p><strong>Status:</strong> <Badge value={detail.booking.booking_status} /></p>
                        <p><strong>Amount:</strong> {fmtMoney(detail.booking.amount)}</p>
                        <p><strong>Customer:</strong> {detail.booking.customer_email}</p>
                        <p><strong>Provider:</strong> {detail.booking.provider_name} ({detail.booking.provider_email})</p>
                        <p><strong>Service:</strong> {detail.booking.service_name}</p>
                        <p><strong>Scheduled:</strong> {fmtDate(detail.booking.scheduled_at)}</p>
                        <p><strong>Payment:</strong> {detail.booking.payment_status || 'none'}</p>
                        <p><strong>Messages:</strong> {detail.message_count}</p>
                    </div>
                    <div><p className="font-semibold">Address</p><p className="text-gray-600">{detail.booking.address}</p></div>
                    <div><p className="font-semibold">Description</p><p className="text-gray-600">{detail.booking.service_description || '—'}</p></div>
                    <div>
                        <p className="font-bold text-slate-800 mb-1">Status history</p>
                        {detail.status_history.length === 0 ? <p className="text-gray-500">No history recorded.</p> : (
                            <ul className="space-y-1">
                                {detail.status_history.map((h) => (
                                    <li key={h.id} className="border-l-2 border-cyan-500 pl-3">
                                        <Badge value={h.status} /> <span className="text-gray-500 text-xs">{fmtDate(h.created_at)} · {h.changed_by_role || 'system'}</span>
                                        {h.note && <p className="text-gray-600">{h.note}</p>}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </Modal>
    );
};

const BookingsTab = ({ token }) => {
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [page, setPage] = useState(1);
    const [detailId, setDetailId] = useState(null);
    const [dialog, setDialog] = useState(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const { data, pagination, loading, error, reload } = useAdminList('/admin/bookings', `page=${page}&limit=15${status ? `&status=${status}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`, token);

    const changeStatus = async (reason) => {
        setBusy(true);
        setActionError('');
        try {
            await apiRequest(`/admin/bookings/${dialog.booking.id}/status`, {
                token,
                method: 'PATCH',
                body: { status: dialog.status, reason },
            });
            setNotice(`Booking #${dialog.booking.id} set to ${dialog.status}. History and audit log updated.`);
            setDialog(null);
            await reload();
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Bookings</h2>
                    <p className="text-sm text-gray-500">Search by booking ID, customer or provider email.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="px-3 py-2 border rounded-lg text-sm">
                        <option value="">All statuses</option>
                        {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </select>
                    <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Booking ID or email" className="px-3 py-2 border rounded-lg text-sm" />
                    <button onClick={() => { setSearch(searchInput.trim()); setPage(1); }} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold">Search</button>
                </div>
            </div>

            {notice && <SuccessMessage message={notice} />}
            {actionError && <ErrorMessage message={actionError} />}
            {error && <ErrorMessage message={error} />}
            {loading && <Spinner />}

            {!loading && !error && (
                <>
                    <Table headers={['ID', 'Service', 'Customer', 'Provider', 'Scheduled', 'Amount', 'Status', 'Actions']}>
                        {data.map((b) => (
                            <tr key={b.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 font-mono">#{b.id}</td>
                                <td className="px-4 py-3">{b.service_name}</td>
                                <td className="px-4 py-3 text-xs text-gray-600">{b.customer_email}</td>
                                <td className="px-4 py-3 text-xs text-gray-600">{b.provider_name}</td>
                                <td className="px-4 py-3 text-xs text-gray-500">{fmtDay(b.scheduled_at)}</td>
                                <td className="px-4 py-3">{fmtMoney(b.amount)}</td>
                                <td className="px-4 py-3"><Badge value={b.booking_status} /></td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => setDetailId(b.id)} className="text-xs px-2 py-1 border rounded">View</button>
                                        <select
                                            value=""
                                            onChange={(e) => { if (e.target.value) setDialog({ booking: b, status: e.target.value }); }}
                                            className="text-xs border rounded px-1 py-1"
                                            aria-label={`Change status for booking ${b.id}`}
                                        >
                                            <option value="">Status…</option>
                                            {BOOKING_STATUSES.filter((s) => s !== b.booking_status).map((s) => (
                                                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                                            ))}
                                        </select>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </Table>
                    <Pager meta={pagination} onChange={setPage} />
                </>
            )}

            {detailId && <BookingDetail id={detailId} token={token} onClose={() => setDetailId(null)} />}
            {dialog && (
                <ActionDialog
                    title="Change booking status"
                    message={`Booking #${dialog.booking.id}: ${dialog.booking.booking_status} → ${dialog.status}.`}
                    confirmLabel="Update status"
                    requireReason={dialog.status === 'rejected' || dialog.status === 'closed'}
                    busy={busy}
                    onCancel={() => setDialog(null)}
                    onConfirm={changeStatus}
                />
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Reviews & complaints
// ---------------------------------------------------------------------------

const ReviewsTab = ({ token }) => {
    const [hidden, setHidden] = useState('');
    const [page, setPage] = useState(1);
    const [dialog, setDialog] = useState(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const { data, pagination, loading, error, reload } = useAdminList('/admin/reviews', `page=${page}&limit=15${hidden ? `&hidden=${hidden}` : ''}`, token);

    const act = async (reason) => {
        setBusy(true);
        setActionError('');
        try {
            await apiRequest(`/admin/reviews/${dialog.review.id}/moderate`, { token, method: 'PATCH', body: { action: dialog.action, reason } });
            setNotice(`Review #${dialog.review.id} ${dialog.action === 'hide' ? 'hidden' : 'restored'}. Provider rating recalculated.`);
            setDialog(null);
            await reload();
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Reviews</h2>
                    <p className="text-sm text-gray-500">Hidden reviews are excluded from the public rating.</p>
                </div>
                <select value={hidden} onChange={(e) => { setHidden(e.target.value); setPage(1); }} className="px-3 py-2 border rounded-lg text-sm">
                    <option value="">All reviews</option><option value="false">Visible only</option><option value="true">Hidden only</option>
                </select>
            </div>
            {notice && <SuccessMessage message={notice} />}
            {actionError && <ErrorMessage message={actionError} />}
            {error && <ErrorMessage message={error} />}
            {loading && <Spinner />}
            {!loading && !error && (
                <>
                    <Table headers={['ID', 'Provider', 'Customer', 'Rating', 'Comment', 'Visible', 'Actions']}>
                        {data.map((r) => (
                            <tr key={r.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 font-mono">#{r.id}</td>
                                <td className="px-4 py-3">{r.provider_name}</td>
                                <td className="px-4 py-3 text-xs text-gray-600">{r.customer_email}</td>
                                <td className="px-4 py-3 font-semibold">{r.rating}/5</td>
                                <td className="px-4 py-3 text-gray-600 max-w-xs">{r.comment || '—'}</td>
                                <td className="px-4 py-3"><Badge value={r.is_hidden ? 'suspended' : 'active'} /></td>
                                <td className="px-4 py-3">
                                    <button onClick={() => setDialog({ review: r, action: r.is_hidden ? 'unhide' : 'hide' })} className={`text-xs px-2 py-1 rounded text-white ${r.is_hidden ? 'bg-green-600' : 'bg-orange-600'}`}>{r.is_hidden ? 'Restore' : 'Hide'}</button>
                                </td>
                            </tr>
                        ))}
                    </Table>
                    <Pager meta={pagination} onChange={setPage} />
                </>
            )}
            {dialog && (
                <ActionDialog
                    title={dialog.action === 'hide' ? 'Hide review' : 'Restore review'}
                    message={`Review #${dialog.review.id} on ${dialog.review.provider_name}.`}
                    confirmLabel={dialog.action === 'hide' ? 'Hide review' : 'Restore'}
                    requireReason={dialog.action === 'hide'}
                    busy={busy}
                    onCancel={() => setDialog(null)}
                    onConfirm={act}
                />
            )}
        </div>
    );
};

const ComplaintsTab = ({ token }) => {
    const [resolved, setResolved] = useState('false');
    const [page, setPage] = useState(1);
    const [busyId, setBusyId] = useState(null);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const { data, pagination, loading, error, reload } = useAdminList('/admin/complaints', `page=${page}&limit=15${resolved ? `&resolved=${resolved}` : ''}`, token);

    const toggle = async (complaint) => {
        setBusyId(complaint.id);
        setActionError('');
        try {
            await apiRequest(`/admin/complaints/${complaint.id}/resolve`, { token, method: 'PATCH', body: { resolved: !complaint.is_resolved } });
            setNotice(`Complaint #${complaint.id} ${complaint.is_resolved ? 'reopened' : 'resolved'}.`);
            await reload();
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Complaints</h2>
                    <p className="text-sm text-gray-500">Messages submitted through the public Contact form.</p>
                </div>
                <select value={resolved} onChange={(e) => { setResolved(e.target.value); setPage(1); }} className="px-3 py-2 border rounded-lg text-sm">
                    <option value="">All</option><option value="false">Open</option><option value="true">Resolved</option>
                </select>
            </div>
            {notice && <SuccessMessage message={notice} />}
            {actionError && <ErrorMessage message={actionError} />}
            {error && <ErrorMessage message={error} />}
            {loading && <Spinner />}
            {!loading && !error && (
                <>
                    <div className="space-y-3">
                        {data.map((c) => (
                            <div key={c.id} className="border rounded-xl p-4 bg-white">
                                <div className="flex flex-wrap justify-between items-start gap-2">
                                    <div>
                                        <p className="font-semibold text-slate-800">#{c.id} · {c.sender_name}</p>
                                        <p className="text-xs text-gray-500">{c.sender_email} · {fmtDate(c.created_at)}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Badge value={c.is_resolved ? 'closed' : 'pending'} />
                                        <button onClick={() => toggle(c)} disabled={busyId === c.id} className="text-xs font-semibold px-3 py-1.5 rounded bg-slate-800 text-white disabled:bg-gray-400">{c.is_resolved ? 'Reopen' : 'Mark resolved'}</button>
                                    </div>
                                </div>
                                <p className="text-sm text-gray-700 mt-3 whitespace-pre-wrap">{c.message}</p>
                            </div>
                        ))}
                        {data.length === 0 && <p className="text-center text-gray-500 bg-gray-100 p-8 rounded-xl">No complaints in this view.</p>}
                    </div>
                    <Pager meta={pagination} onChange={setPage} />
                </>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Wallet requests (existing feature)
// ---------------------------------------------------------------------------

const WalletTab = ({ token }) => {
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busyId, setBusyId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setRequests(await apiRequest('/admin/wallet-requests', { token }));
            setError('');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { load(); }, [load]);

    const act = async (request, action) => {
        setBusyId(request.id);
        try {
            const result = await apiRequest(`/admin/wallet-requests/${request.id}/${action}`, {
                token,
                method: 'PUT',
                body: action === 'reject' ? { reason: 'Rejected by administrator.' } : {},
            });
            setNotice(result.message);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-800">Wallet requests</h2>
            <p className="text-sm text-gray-500">Approve customer deposits and provider withdrawals.</p>
            {notice && <SuccessMessage message={notice} />}
            {error && <ErrorMessage message={error} />}
            {loading && <Spinner />}
            {!loading && requests.length === 0 && <p className="text-center text-gray-500 bg-gray-100 p-8 rounded-xl">No wallet requests.</p>}
            <div className="space-y-3">
                {requests.map((r) => (
                    <div key={r.id} className="border rounded-xl p-4 bg-white flex flex-wrap justify-between gap-3">
                        <div>
                            <p className="font-semibold text-slate-800">#{r.id} · {r.type.toUpperCase()} · {fmtMoney(r.amount)}</p>
                            <p className="text-xs text-gray-500">{r.email} ({r.role}) · {fmtDate(r.requested_at)}</p>
                            {r.screenshot_url && <a href={r.screenshot_url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-700 underline">View payment proof</a>}
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge value={r.status} />
                            {r.status === 'pending' && (
                                <>
                                    <button onClick={() => act(r, 'approve')} disabled={busyId === r.id} className="text-xs px-3 py-1.5 rounded bg-green-600 text-white disabled:bg-gray-400">Approve</button>
                                    <button onClick={() => act(r, 'reject')} disabled={busyId === r.id} className="text-xs px-3 py-1.5 rounded bg-red-600 text-white disabled:bg-gray-400">Reject</button>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Audit logs & settings
// ---------------------------------------------------------------------------

const AuditTab = ({ token }) => {
    const [action, setAction] = useState('');
    const [input, setInput] = useState('');
    const [page, setPage] = useState(1);
    const { data, pagination, loading, error } = useAdminList('/admin/audit-logs', `page=${page}&limit=20${action ? `&action=${encodeURIComponent(action)}` : ''}`, token);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Audit logs</h2>
                    <p className="text-sm text-gray-500">Append-only record of administrator actions, newest first.</p>
                </div>
                <div className="flex gap-2">
                    <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Filter by action (e.g. provider)" className="px-3 py-2 border rounded-lg text-sm" />
                    <button onClick={() => { setAction(input.trim()); setPage(1); }} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold">Filter</button>
                </div>
            </div>
            {error && <ErrorMessage message={error} />}
            {loading && <Spinner />}
            {!loading && !error && (
                <>
                    <Table headers={['ID', 'When', 'Admin', 'Action', 'Target', 'Reason']}>
                        {data.map((entry) => (
                            <tr key={entry.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 font-mono text-gray-500">#{entry.id}</td>
                                <td className="px-4 py-3 text-xs text-gray-600">{fmtDate(entry.created_at)}</td>
                                <td className="px-4 py-3">{entry.admin_email}</td>
                                <td className="px-4 py-3 font-semibold">{entry.action}</td>
                                <td className="px-4 py-3 text-xs text-gray-600">{entry.target_type ? `${entry.target_type} #${entry.target_id}` : '—'}</td>
                                <td className="px-4 py-3 text-gray-600 max-w-sm">{entry.reason || '—'}</td>
                            </tr>
                        ))}
                    </Table>
                    <Pager meta={pagination} onChange={setPage} />
                </>
            )}
        </div>
    );
};

const SettingsTab = ({ token }) => {
    const [definitions, setDefinitions] = useState([]);
    const [draft, setDraft] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const body = await apiRequest('/admin/settings', { token });
            setDefinitions(body.definitions || []);
            setDraft(body.settings || {});
            setError('');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { load(); }, [load]);

    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
            const body = await apiRequest('/admin/settings', { token, method: 'PATCH', body: { settings: draft } });
            setDraft(body.settings);
            setNotice('Platform settings updated.');
            setError('');
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <Spinner />;

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-800">Platform settings</h2>
            <p className="text-sm text-gray-500">Non-secret operational settings only. Environment credentials are never exposed here.</p>
            {notice && <SuccessMessage message={notice} />}
            {error && <ErrorMessage message={error} />}
            <form onSubmit={save} className="space-y-4 max-w-2xl">
                {definitions.map((d) => (
                    <div key={d.key} className="border-b border-gray-100 pb-3">
                        <label htmlFor={d.key} className="block text-sm font-semibold text-gray-700">{d.key.replace(/_/g, ' ')}</label>
                        {d.type === 'bool' ? (
                            <input id={d.key} type="checkbox" checked={Boolean(draft[d.key])} onChange={(e) => setDraft({ ...draft, [d.key]: e.target.checked })} className="mt-2" />
                        ) : d.type === 'enum' ? (
                            <select id={d.key} value={draft[d.key]} onChange={(e) => setDraft({ ...draft, [d.key]: e.target.value })} className="mt-1 block w-full max-w-xs px-3 py-2 border rounded-lg text-sm">
                                {d.values.map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                        ) : (
                            <input id={d.key} type="number" min={d.min} max={d.max} value={draft[d.key]} onChange={(e) => setDraft({ ...draft, [d.key]: Number(e.target.value) })} className="mt-1 block w-full max-w-xs px-3 py-2 border rounded-lg text-sm" />
                        )}
                        <p className="text-xs text-gray-500 mt-1">Default: {String(d.default)}{d.min !== undefined ? ` · range ${d.min}–${d.max}` : ''}</p>
                    </div>
                ))}
                <button type="submit" disabled={saving} className={`${DARK_CYAN_CLASS} text-white font-semibold px-5 py-2.5 rounded-lg ${DARK_CYAN_HOVER_CLASS} disabled:bg-gray-400`}>{saving ? 'Saving…' : 'Save settings'}</button>
            </form>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
    ['overview', 'Overview', '📊'],
    ['providers', 'Providers', '🛠️'],
    ['users', 'Users', '👥'],
    ['services', 'Services', '🗂️'],
    ['bookings', 'Bookings', '📅'],
    ['reviews', 'Reviews', '⭐'],
    ['complaints', 'Complaints', '📨'],
    ['wallet', 'Wallet requests', '💳'],
    ['audit', 'Audit logs', '📜'],
    ['settings', 'Settings', '⚙️'],
];

export const AdminDashboard = ({ setPage }) => {
    const { user, token, loading, logout } = useAuth();
    const [activeTab, setActiveTab] = useState('overview');

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
    }

    // Frontend guarding is convenience only; every API call is independently
    // authorized by the backend.
    if (!token || user?.role !== 'admin') {
        return <AdminLoginPage setPage={setPage} />;
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col lg:flex-row">
            <aside className="bg-slate-900 text-slate-200 lg:w-64 lg:min-h-screen flex-shrink-0">
                <div className="px-5 py-5 border-b border-slate-800">
                    <p className="text-cyan-400 text-xs font-bold tracking-widest uppercase">Service Connect</p>
                    <p className="text-lg font-extrabold text-white mt-1">Admin Console</p>
                </div>
                <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
                    {NAV_ITEMS.map(([tab, label, icon]) => (
                        <button key={tab} onClick={() => setActiveTab(tab)}
                            className={`flex items-center gap-2 whitespace-nowrap px-3 py-2.5 rounded-lg text-sm font-medium ${activeTab === tab ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
                            <span aria-hidden="true">{icon}</span>{label}
                        </button>
                    ))}
                </nav>
            </aside>

            <div className="flex-1 min-w-0">
                <header className="bg-white border-b px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">Administrator</p>
                        <p className="text-sm font-semibold text-slate-800">{user?.email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => setPage('home')} className="text-sm font-semibold text-cyan-700 hover:text-cyan-900">View site</button>
                        <button onClick={() => { logout(); setPage('adminLogin'); }} className="bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-red-700">Sign out</button>
                    </div>
                </header>
                <main className="p-4 sm:p-6 max-w-7xl mx-auto">
                    {activeTab === 'overview' && <OverviewTab token={token} />}
                    {activeTab === 'providers' && <ProvidersTab token={token} />}
                    {activeTab === 'users' && <UsersTab token={token} />}
                    {activeTab === 'services' && <ServicesTab token={token} />}
                    {activeTab === 'bookings' && <BookingsTab token={token} />}
                    {activeTab === 'reviews' && <ReviewsTab token={token} />}
                    {activeTab === 'complaints' && <ComplaintsTab token={token} />}
                    {activeTab === 'wallet' && <WalletTab token={token} />}
                    {activeTab === 'audit' && <AuditTab token={token} />}
                    {activeTab === 'settings' && <SettingsTab token={token} />}
                </main>
            </div>
        </div>
    );
};
