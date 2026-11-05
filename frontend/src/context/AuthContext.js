// frontend/src/context/AuthContext.js

import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { API_BASE_URL } from '../pages/utils/helpers';

// --- AUTH CONTEXT ---

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);
    const [unreadCount, setUnreadCount] = useState(0); 

    const logout = useCallback(() => {
        setUser(null);
        setToken(null);
        localStorage.removeItem('token');
    }, []);

    const fetchUserProfile = useCallback(async (authToken) => {
        if (!authToken) {
            setUser(null);
            setLoading(false);
            return;
        }
        try {
            const response = await fetch(`${API_BASE_URL}/user/profile`, {
                headers: { 'x-auth-token': authToken },
            });
            const data = await response.json();
            
            if (response.ok) {
                setUser(data.user_profile);
            } else {
                logout(); 
            }
        } catch (error) {
            console.error("Failed to fetch user profile:", error);
            logout();
        } finally {
            setLoading(false);
        }
    }, [logout]);
    
    // New: Fetch unread message count (for the bell icon)
    const fetchUnreadCount = useCallback(async (authToken) => {
        if (!authToken || !user || user.role === 'admin') return;
        try {
            const response = await fetch(`${API_BASE_URL}/user/unread-messages`, {
                headers: { 'x-auth-token': authToken },
            });
            if (response.ok) {
                const data = await response.json();
                setUnreadCount(data.unread_count || 0);
            }
        } catch (error) {
            console.error("Failed to fetch unread count:", error);
        }
    }, [user]);

    useEffect(() => {
        const storedToken = localStorage.getItem('token');
        fetchUserProfile(storedToken);
    }, [fetchUserProfile]);
    
    // Polling for unread count
    useEffect(() => {
        if (!token || loading || user?.role === 'admin') return;
        
        // Fetch immediately, then set up poll
        fetchUnreadCount(token); 
        
        const interval = setInterval(() => {
            fetchUnreadCount(token);
        }, 15000); // Poll every 15 seconds

        return () => clearInterval(interval);
    }, [token, loading, fetchUnreadCount, user]);

    // New: Mark messages as read
    const markMessagesAsRead = useCallback(async (bookingId) => {
        if (!token) return;
        try {
             const response = await fetch(`${API_BASE_URL}/messages/read`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                body: JSON.stringify({ booking_id: bookingId }),
            });
            if (response.ok) {
                fetchUnreadCount(token); // Refresh header count
            }
        } catch (error) {
            console.error('Failed to mark messages as read:', error);
        }
    }, [token, fetchUnreadCount]);


    const login = async (email, password) => {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await response.json();
            if (response.ok) {
                localStorage.setItem('token', data.token);
                setToken(data.token);
                await fetchUserProfile(data.token);
                return { success: true, role: data.role };
            } else {
                return { success: false, message: data.error || 'Login failed' };
            }
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    };

    // Separate administrator sign-in. Only /admin/login accepts admin accounts;
    // the general login endpoint no longer promotes accounts by email.
    const adminLogin = async (email, password) => {
        try {
            const response = await fetch(`${API_BASE_URL}/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await response.json();
            if (response.ok) {
                localStorage.setItem('token', data.token);
                setToken(data.token);
                await fetchUserProfile(data.token);
                return { success: true, role: 'admin' };
            }
            return { success: false, message: data.error || 'Administrator login failed.' };
        } catch (error) {
            return { success: false, message: 'Network error. Please try again.' };
        }
    };

    const register = async (email, password, role) => {
         try {
            const response = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, role }),
            });
            const data = await response.json();
            if (response.ok) {
                return { success: true, message: data.message };
            } else {
                return { success: false, message: data.error || 'Registration failed' };
            }
        } catch (error) {
            return { success: false, message: 'Network error' };
        }
    };
    
    // New: OTP Verification during Registration
    const verifyOtp = async (email, otp) => {
         try {
            const response = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp }),
            });
            const data = await response.json();
            if (response.ok) {
                return { success: true, role: data.role };
            } else {
                return { success: false, message: data.error || 'Invalid OTP or account not found.' };
            }
        } catch (error) {
            return { success: false, message: 'Network error' };
        }
    };


    const sendOtp = async (email) => {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await response.json();
            if (response.ok) {
                return { success: true, message: data.message };
            } else {
                return { success: false, message: data.error || 'Failed to send OTP.' };
            }
        } catch (error) {
            return { success: false, message: 'Network error.' };
        }
    };

    const resetPassword = async (email, otp, newPassword) => {
        try {
            const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp, new_password: newPassword }),
            });
            const data = await response.json();
            if (response.ok) {
                return { success: true, message: data.message };
            } else {
                return { success: false, message: data.error || 'Invalid code or password.' };
            }
        } catch (error) {
            return { success: false, message: 'Network error.' };
        }
    };

    const value = { 
        user, 
        token, 
        login, 
        adminLogin,
        logout, 
        register, 
        loading, 
        isAuthenticated: !!user, 
        fetchUserProfile, 
        refreshUser: () => fetchUserProfile(token),
        sendOtp, 
        resetPassword,
        verifyOtp, 
        unreadCount, 
        markMessagesAsRead, 
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);