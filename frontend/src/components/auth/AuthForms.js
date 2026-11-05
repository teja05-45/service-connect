import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    API_BASE_URL,
    isValidLatitude,
    isValidLongitude,
    requestBrowserLocation,
} from '../../pages/utils/helpers';
import { ErrorMessage, SuccessMessage } from '../shared/UI';


// --- Shared Auth Container ---
export const AuthFormContainer = ({ children, title }) => (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
            <h2 className="mt-6 text-center text-4xl font-extrabold text-slate-900">{title}</h2>
        </div>
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
            <div className="bg-white py-8 px-4 shadow-2xl rounded-xl sm:px-10 border border-gray-200">
                {children}
            </div>
        </div>
    </div>
);


// --- Login Page ---
export const LoginPage = ({ setPage }) => {
    const { login } = useAuth();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        const email = e.target.email.value;
        const password = e.target.password.value;
        const result = await login(email, password);
        setLoading(false);
        if (result.success) {
             if (result.role === 'admin') setPage('adminDashboard');
             else if (result.role === 'provider') setPage('providerDashboard');
             else setPage('customerDashboard');
        } else {
            setError(result.message || 'Invalid credentials.');
        }
    };
    
    return (
        <AuthFormContainer title="Sign in to Service Connect">
            <form className="space-y-6" onSubmit={handleSubmit}>
                <div>
                    <label htmlFor="email" className="block text-sm font-semibold text-gray-700">Email address</label>
                    <input id="email" name="email" type="email" required className="mt-1 appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 transition"/>
                </div>
                <div>
                    <label htmlFor="password" className="block text-sm font-semibold text-gray-700">Password</label>
                    <input id="password" name="password" type="password" required className="mt-1 appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 transition"/>
                </div>
                {error && <ErrorMessage message={error}/>}
                <div className="text-sm text-right">
                    <a onClick={() => setPage('forgotPassword')} className="font-medium text-blue-600 hover:text-blue-700 cursor-pointer transition">Forgot your password?</a>
                </div>
                <button type="submit" disabled={loading} className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-md font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:bg-gray-400">
                    {loading ? 'Signing in...' : 'Sign in'}
                </button>
            </form>
            <div className="mt-6 text-center text-sm">
                Don't have an account? <a onClick={() => setPage('register')} className="font-medium text-blue-600 hover:text-blue-700 cursor-pointer transition">Register here</a>
            </div>
        </AuthFormContainer>
    );
};

// --- OTP Verification Page (Hidden component, used by RegisterPage) ---
export const RegisterOtpPage = ({ email, password, role, primaryServiceId, setPage }) => {
    const { verifyOtp, login } = useAuth();
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);
    
    const handleOtpSubmit = async (e) => {
        e.preventDefault();
        setError(''); setSuccess(''); setLoading(true);
        const otp = e.target.otp.value;
        
        const result = await verifyOtp(email, otp);
        setLoading(false);
        
        if (result.success) {
            setSuccess('Verification successful! Logging you in...');
            
            const loginResult = await login(email, password); 
            
            if (loginResult.success) {
                if (role === 'provider') {
                    setPage('providerSetup', { primaryServiceId: primaryServiceId });
                } else {
                    setPage('customerDashboard');
                }
            } else {
                setPage('login'); 
            }
        } else {
            setError(result.message || 'Invalid or expired OTP.');
        }
    };
    
    return (
        <AuthFormContainer title="Verify Your Email">
            <p className="text-center text-sm text-gray-600 mb-6">A 6-digit code has been sent to <span className="font-semibold text-slate-800">{email}</span>. Check your inbox.</p>
            <form className="space-y-6" onSubmit={handleOtpSubmit}>
                <div>
                    <label htmlFor="otp" className="block text-sm font-semibold text-gray-700">6-Digit OTP</label>
                    <input id="otp" name="otp" type="text" maxLength="6" required className="mt-1 appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 transition"/>
                </div>
                 
                {success && <SuccessMessage message={success}/>}
                {error && <ErrorMessage message={error}/>}
                <button type="submit" disabled={loading} className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-md font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:bg-gray-400">
                    {loading ? 'Verifying...' : 'Verify Account'}
                </button>
            </form>
             <div className="mt-6 text-center text-sm">
                Wrong email? <a onClick={() => setPage('register')} className="font-medium text-blue-600 hover:text-blue-700 cursor-pointer transition">Go back and re-register</a>
            </div>
        </AuthFormContainer>
    );
};


// --- Register Page ---
export const RegisterPage = ({ setPage }) => {
    const { register } = useAuth();
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [services, setServices] = useState([]);
    const [role, setRole] = useState('customer');
    const [primaryService, setPrimaryService] = useState('');
    const [isRegistered, setIsRegistered] = useState(false);
    const [regEmail, setRegEmail] = useState('');
    const [regPassword, setRegPassword] = useState('');
    const [regRole, setRegRole] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const fetchServices = async () => {
            const res = await fetch(`${API_BASE_URL}/services`);
            const data = await res.json();
            if (data && data.length > 0) {
              setServices(data || []);
              setPrimaryService(data[0].id);
            }
        };
        fetchServices();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(''); setSuccess(''); setLoading(true);
        const email = e.target.email.value;
        const password = e.target.password.value;
        
        const result = await register(email, password, role);
        setLoading(false);
        if (result.success) {
            setSuccess(result.message);
            setRegEmail(email);
            setRegPassword(password);
            setRegRole(role);
            setIsRegistered(true);
        } else {
            setError(result.message || "Registration failed.");
        }
    };
    
    // Switch to OTP verification page if registration initiated
    if (isRegistered) {
        // FIX: Passing primaryServiceId to the OTP page
        // THIS IS WHERE RegisterOtpPage IS USED:
        return <RegisterOtpPage email={regEmail} password={regPassword} role={regRole} primaryServiceId={primaryService} setPage={setPage} />;
    }

    return (
        <AuthFormContainer title="Create an account">
             <form className="space-y-6" onSubmit={handleSubmit}>
                <div>
                    <label htmlFor="role" className="block text-sm font-semibold text-gray-700">I am a...</label>
                    <select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)} required 
                        className="mt-1 block w-full pl-4 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition">
                        <option value="customer">Customer (Looking for services)</option>
                        <option value="provider">Service Provider (Offering services)</option>
                    </select>
                </div>
                {role === 'provider' && services.length > 0 && (
                     <div>
                        <label htmlFor="service" className="block text-sm font-semibold text-gray-700">Primary Service Category</label>
                        <select id="service" name="service" value={primaryService} onChange={e => setPrimaryService(e.target.value)} required 
                            className="mt-1 block w-full pl-4 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition">
                            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                )}
                <div>
                    <label htmlFor="email" className="block text-sm font-semibold text-gray-700">Email address</label>
                    <input id="email" name="email" type="email" required className="mt-1 appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 transition"/>
                </div>
                <div>
                    <label htmlFor="password" className="block text-sm font-semibold text-gray-700">Password</label>
                    <input id="password" name="password" type="password" required className="mt-1 appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 transition"/>
                </div>
                {error && <ErrorMessage message={error}/>}
                {success && <SuccessMessage message={success}/>}
                <button type="submit" disabled={loading} className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-md font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:bg-gray-400">
                    {loading ? 'Creating Account...' : 'Create Account'}
                </button>
            </form>
            <div className="mt-6 text-center text-sm">
                Already have an account? <a onClick={() => setPage('login')} className="font-medium text-blue-600 hover:text-blue-700 cursor-pointer transition">Sign in</a>
            </div>
        </AuthFormContainer>
    );
};

// --- Forgot Password Page ---
export const ForgotPasswordPage = ({ setPage }) => {
    const { sendOtp, resetPassword } = useAuth();
    const [step, setStep] = useState(1);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);

    const handleEmailSubmit = async (e) => {
        e.preventDefault();
        setError(''); setMessage(''); setLoading(true);
        const submittedEmail = e.target.email.value;
        setEmail(submittedEmail);
        
        const result = await sendOtp(submittedEmail); 
        setLoading(false);
        
        if(result.success) {
            setMessage(result.message);
            setStep(2);
        } else {
            setError(result.message || 'Failed to send OTP.');
        }
    };

    const handleOtpSubmit = async (e) => {
        e.preventDefault();
        setError(''); setMessage(''); setLoading(true);
        const otp = e.target.otp.value;
        const newPassword = e.target.newPassword.value;

        const result = await resetPassword(email, otp, newPassword);
        setLoading(false);
        
        if (result.success) {
            setMessage('Your password has been successfully reset. Redirecting to login...');
            setTimeout(() => setPage('login'), 2000);
        } else {
            setError(result.message || 'Invalid code or password.');
        }
    };
    
    if (step === 2) {
        return (
            <AuthFormContainer title="Reset Your Password">
                <p className="text-center text-sm text-gray-600 mb-6">A 6-digit code has been sent to <span className="font-semibold text-slate-800">{email}</span>.</p>
                <form className="space-y-6" onSubmit={handleOtpSubmit}>
                     <div>
                        <label htmlFor="otp" className="block text-sm font-semibold text-gray-700">6-Digit OTP</label>
                        <input id="otp" name="otp" type="text" maxLength="6" required  className="mt-1 appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 transition"
/>

                    </div>
                     <div>
                        <label htmlFor="newPassword" className="block text-sm font-semibold text-gray-700">New Password</label>
                        <input id="newPassword" name="newPassword" type="password" required className="mt-1 appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 transition"/>
                    </div>
                    {message && <SuccessMessage message={message}/>}
                    {error && <ErrorMessage message={error}/>}
                    <button type="submit" disabled={loading} className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-md font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:bg-gray-400">
                        {loading ? 'Processing...' : 'Reset Password'}
                    </button>
                </form>
            </AuthFormContainer>
        );
    }

    return (
        <AuthFormContainer title="Forgot Password">
            <p className="text-center text-sm text-gray-600 mb-6">Enter your account's email address to receive a password reset code.</p>
            <form className="space-y-6" onSubmit={handleEmailSubmit}>
                <div>
                    <label htmlFor="email" className="block text-sm font-semibold text-gray-700">Email address</label>
                    <input id="email" name="email" type="email" required className="mt-1 appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 transition"/>
                </div>
                {message && <SuccessMessage message={message} />}
                {error && <ErrorMessage message={error} />}
                <button type="submit" disabled={loading} className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-md font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:bg-gray-400">
                    {loading ? 'Sending...' : 'Send Reset Code'}
                </button>
            </form>
            <div className="mt-6 text-center text-sm">
                Remember your password? <a onClick={() => setPage('login')} className="font-medium text-blue-600 hover:text-blue-700 cursor-pointer transition">Sign in</a>
            </div>
        </AuthFormContainer>
    );
};

// --- Administrator Login (separate interface) ---
export const AdminLoginPage = ({ setPage }) => {
    const { adminLogin } = useAuth();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        const result = await adminLogin(e.target.email.value, e.target.password.value);
        setLoading(false);

        if (result.success) {
            setPage('adminDashboard');
        } else {
            setError(result.message || 'Invalid administrator credentials.');
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <p className="text-cyan-400 font-bold tracking-widest text-xs uppercase">Service Connect</p>
                    <h1 className="text-3xl font-extrabold text-white mt-2">Administrator sign in</h1>
                    <p className="text-slate-400 text-sm mt-2">
                        This area is restricted to platform administrators. Customer and provider accounts cannot sign in here.
                    </p>
                </div>
                <div className="bg-white py-8 px-6 shadow-2xl rounded-xl sm:px-10 border border-slate-700">
                    <form className="space-y-5" onSubmit={handleSubmit}>
                        <div>
                            <label htmlFor="admin-email" className="block text-sm font-semibold text-gray-700">Administrator email</label>
                            <input id="admin-email" name="email" type="email" autoComplete="username" required
                                className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-slate-500 focus:border-slate-500" />
                        </div>
                        <div>
                            <label htmlFor="admin-password" className="block text-sm font-semibold text-gray-700">Password</label>
                            <input id="admin-password" name="password" type="password" autoComplete="current-password" required
                                className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-slate-500 focus:border-slate-500" />
                        </div>
                        {error && <ErrorMessage message={error} />}
                        <button type="submit" disabled={loading}
                            className="w-full py-3 rounded-lg font-bold text-white bg-slate-900 hover:bg-slate-800 transition disabled:bg-gray-400">
                            {loading ? 'Signing in...' : 'Sign in as administrator'}
                        </button>
                    </form>
                    <button
                        type="button"
                        onClick={() => setPage('home')}
                        className="mt-5 w-full text-center text-sm font-medium text-slate-600 hover:text-slate-900"
                    >
                        &larr; Back to Service Connect
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- Provider Setup Page ---
export const ProviderSetupPage = ({ setPage, pageData }) => {
    const { token } = useAuth();
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const [radiusKm, setRadiusKm] = useState('10');
    const [locating, setLocating] = useState(false);
    const [locationError, setLocationError] = useState('');

    const useBrowserLocation = async () => {
        setLocationError('');
        setLocating(true);
        try {
            const next = await requestBrowserLocation();
            setLatitude(next.lat.toFixed(6));
            setLongitude(next.lon.toFixed(6));
        } catch (err) {
            setLocationError(err.message);
        } finally {
            setLocating(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(''); setSuccess(''); setLoading(true);

        // FIX: Retrieving primaryServiceId from pageData
        if (!pageData || !pageData.primaryServiceId) {
             setError('Primary service ID is missing. Please re-register.');
             setLoading(false);
             return;
        }

        const lat = Number(latitude);
        const lon = Number(longitude);
        const radius = Number(radiusKm);

        if (!isValidLatitude(lat) || !isValidLongitude(lon) || (lat === 0 && lon === 0)) {
            setLocationError('Enter a real service location: latitude -90..90, longitude -180..180, (0,0) is not allowed.');
            setLoading(false);
            return;
        }
        if (!Number.isInteger(radius) || radius < 1 || radius > 100) {
            setLocationError('Service radius must be a whole number between 1 and 100 km.');
            setLoading(false);
            return;
        }

        const profileData = {
            display_name: e.target.display_name.value,
            bio: e.target.bio.value,
            location_lat: lat,
            location_lon: lon,
            service_radius_km: radius,
            service_ids: [pageData.primaryServiceId],
            payout_upi_id: e.target.payout_upi_id.value
        };

        try {
            const response = await fetch(`${API_BASE_URL}/provider/profile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': token,
                },
                body: JSON.stringify(profileData),
            });
            const data = await response.json();
            setLoading(false);
            if (response.ok) {
                setSuccess('Profile setup complete! Redirecting to your dashboard...');
                setTimeout(() => setPage('providerDashboard'), 2000);
            } else {
                setError(data.error || 'Failed to set up profile. Check if you already have a profile.');
            }
        } catch (err) {
            setLoading(false);
            setError('A network error occurred.');
        }
    };

    return (
        <AuthFormContainer title="Set Up Your Provider Profile">
            <p className="text-center text-sm text-gray-600 mb-6">Complete these details to make your profile visible to customers.</p>
            <form className="space-y-6" onSubmit={handleSubmit}>
                <div>
                    <label htmlFor="display_name" className="block text-sm font-semibold text-gray-700">Display Name (e.g., Rajesh Sharma, R.S. Electric)</label>
                    <input id="display_name" name="display_name" type="text" required className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg" />
                </div>
                <div>
                    <label htmlFor="bio" className="block text-sm font-semibold text-gray-700">Short Bio / Expertise Summary</label>
                    <textarea id="bio" name="bio" rows="3" required className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg" placeholder="Describe your services and experience (Max 250 chars)..."></textarea>
                </div>
                <h3 className="text-lg font-bold text-slate-700 border-b pb-2">Service Location</h3>
                <p className="text-xs text-gray-500">
                    Customers only see your profile when they search within this radius. Your exact address is never shown in search results.
                </p>
                <button
                    type="button"
                    onClick={useBrowserLocation}
                    disabled={locating}
                    className="text-sm font-semibold text-cyan-700 border border-cyan-600 rounded-lg px-4 py-2 hover:bg-cyan-50 disabled:opacity-60"
                >
                    {locating ? 'Reading location…' : 'Use my current location'}
                </button>
                <div className="grid grid-cols-3 gap-4">
                    <div>
                        <label htmlFor="lat" className="block text-sm font-semibold text-gray-700">Service Latitude</label>
                        <input id="lat" name="lat" type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="e.g. 16.17000" required className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label htmlFor="lon" className="block text-sm font-semibold text-gray-700">Service Longitude</label>
                        <input id="lon" name="lon" type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="e.g. 81.12999" required className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label htmlFor="radius" className="block text-sm font-semibold text-gray-700">Service Radius (km)</label>
                        <input id="radius" name="radius" type="number" min="1" max="100" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} required className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg" />
                    </div>
                </div>
                {locationError && <ErrorMessage message={locationError} />}
                <h3 className="text-lg font-bold text-slate-700 border-b pb-2">Payout Details</h3>
                <div>
                    <label htmlFor="payout_upi_id" className="block text-sm font-semibold text-gray-700">Primary Payout UPI ID / Bank Details</label>
                    <input id="payout_upi_id" name="payout_upi_id" type="text" required className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg" placeholder="E.g., yourname@bank or A/C: 1234"/>
                </div>
                {error && <ErrorMessage message={error}/>}
                {success && <SuccessMessage message={success}/>}
                <button type="submit" disabled={loading} className="w-full flex justify-center py-3 px-4 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md disabled:bg-gray-400">
                    {loading ? 'Saving Profile...' : 'Complete Setup & Go Live'}
                </button>
            </form>
        </AuthFormContainer>
    );
};
