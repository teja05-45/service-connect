// frontend/src/components/shared/UI.js

import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
    DARK_CYAN_CLASS, 
    DARK_CYAN_TEXT_CLASS, 
    DARK_CYAN_HOVER_CLASS,
    getPhotoUrl 
} from '../../pages/utils/helpers';


// --- HELPER & UI COMPONENTS ---

export const Spinner = () => <div className="flex justify-center items-center h-64"><div className={`animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 ${DARK_CYAN_TEXT_CLASS.replace('text', 'border')}`}></div></div>;
export const ErrorMessage = ({ message }) => <div className="text-center text-red-700 bg-red-100 p-4 rounded-lg my-4 font-medium border border-red-300">{message}</div>;

export const ErrorState = ({ title = 'Something went wrong', message, onRetry }) => (
    <div className="text-center bg-red-50 border border-red-200 rounded-xl p-10 my-4">
        <h3 className="text-lg font-bold text-red-800 mb-2">{title}</h3>
        <p className="text-sm text-red-700 mb-4">{message}</p>
        {onRetry && (
            <button onClick={onRetry} className="bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-red-700 transition">
                Try again
            </button>
        )}
    </div>
);
export const SuccessMessage = ({ message }) => <div className="text-center text-green-700 bg-green-100 p-4 rounded-lg my-4 font-medium border border-green-300">{message}</div>;

export const HowItWorksCard = ({ icon, title, description, stars }) => (
    <div className="flex flex-col items-center text-center bg-white p-6 rounded-xl shadow-lg border border-gray-100 w-full">
        <div className={`text-4xl ${DARK_CYAN_TEXT_CLASS} mb-3`}>{icon}</div>
        <h3 className="text-lg font-semibold text-slate-800 mb-1">{title}</h3>
        <p className="text-sm text-gray-600">{description}</p>
        {stars && <p className="text-amber-500 mt-1">{stars}</p>}
    </div>
);


export const Header = ({ setPage }) => {
    const { isAuthenticated, user, logout, unreadCount } = useAuth();
    
    const handleLogout = () => {
        logout();
        setPage('home');
    };
    
    const getDashboardPage = () => {
        if (!user) return 'login';
        switch (user.role) {
            case 'admin': return 'adminDashboard';
            case 'provider': return 'providerDashboard';
            case 'customer': return 'customerDashboard';
            default: return 'home';
        }
    };

    return (
        <header className={`${DARK_CYAN_CLASS} text-white shadow-lg sticky top-0 z-50`}>
            <nav className="container mx-auto px-6 py-4 flex justify-between items-center">
                {/* Home Text Link */}
                <div onClick={() => setPage('home')} className="cursor-pointer text-2xl font-extrabold flex items-center group hover:text-cyan-200 transition">
                    Service Connect
                </div>
                <div className="hidden md:flex items-center space-x-8">
                    <a onClick={() => setPage('home')} className="hover:text-cyan-200 font-medium cursor-pointer transition duration-150">Home</a>
                    <a onClick={() => setPage('allServices')} className="hover:text-cyan-200 font-medium cursor-pointer transition duration-150">Services</a>
                    <a onClick={() => setPage('about')} className="hover:text-cyan-200 font-medium cursor-pointer transition duration-150">About</a>
                    <a onClick={() => setPage('contact')} className="hover:text-cyan-200 font-medium cursor-pointer transition duration-150">Contact</a>
                </div>
                <div className="flex items-center space-x-4">
                    {isAuthenticated ? (
                        <>
                            {/* FIX: Notification Bell (Only for Customer/Provider) */}
                            {user.role !== 'admin' && (
                                <button 
                                    onClick={() => setPage(getDashboardPage())} 
                                    title={unreadCount > 0 ? `You have ${unreadCount} unread messages` : "No new notifications"}
                                    className="relative text-3xl p-1 rounded-full hover:bg-[#006666] transition"
                                >
                                    🔔
                                    {unreadCount > 0 && (
                                        <span className="absolute top-[-8px] right-[-8px] bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center border-2 border-white">
                                            {unreadCount > 9 ? '9+' : unreadCount}
                                        </span>
                                    )}
                                </button>
                            )}

                            {/* Profile Photo in Header */}
                            <img 
                                src={getPhotoUrl(user)} 
                                alt="Profile" 
                                className="w-8 h-8 rounded-full object-cover border-2 border-white cursor-pointer" 
                                onClick={() => setPage(getDashboardPage())}
                            />
                            <button onClick={() => setPage(getDashboardPage())} className="text-white font-semibold hover:text-cyan-200 transition relative hidden sm:block">
                                Dashboard
                            </button>
                            <button onClick={handleLogout} className="bg-red-500 text-white px-4 py-2 rounded-lg shadow-md hover:bg-red-600 transition">
                                Logout
                            </button>
                        </>
                    ) : (
                        <button onClick={() => setPage('login')} className={`bg-white ${DARK_CYAN_TEXT_CLASS} px-4 py-2 rounded-lg shadow-md hover:bg-gray-100 transition font-bold`}>
                            Login / Sign up
                        </button>
                    )}
                </div>
            </nav>
        </header>
    );
};


export const Footer = ({ setPage }) => (
    <footer className="bg-slate-900 text-white mt-16">
        <div className="container mx-auto px-6 py-10">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-8 border-b border-gray-700 pb-8">
                {/* Section 1: Company Info/Customers Say */}
                <div>
                    <h4 className="font-semibold mb-4 text-gray-200">What Our Customers Say</h4>
                    <ul className="space-y-2 text-sm">
                        <li><a className="text-gray-400 hover:text-cyan-400 cursor-pointer transition">Testimonials</a></li>
                        <li><a className="text-gray-400 hover:text-cyan-400 cursor-pointer transition">Reviews</a></li>
                    </ul>
                </div>
                {/* Section 2: Company */}
                <div>
                    <h4 className="font-semibold mb-4 text-gray-200">Company</h4>
                    <ul className="space-y-2 text-sm">
                        <li><a onClick={() => setPage('about')} className="text-gray-400 hover:text-cyan-400 cursor-pointer transition">About Us</a></li>
                        <li><a onClick={() => setPage('contact')} className="text-gray-400 hover:text-cyan-400 cursor-pointer transition">Contact Us</a></li>
                        <li><a className="text-gray-400 hover:text-cyan-400 cursor-pointer transition">Careers</a></li>
                    </ul>
                </div>
                 {/* Section 3: Services */}
                <div>
                    <h4 className="font-semibold mb-4 text-gray-200">Services</h4>
                    <ul className="space-y-2 text-sm">
                        <li><a onClick={() => setPage('allServices')} className="text-gray-400 hover:text-cyan-400 cursor-pointer transition">All Services</a></li>
                        <li><a className="text-gray-400 hover:text-cyan-400 cursor-pointer transition">Terms & Privacy</a></li>
                    </ul>
                </div>
                {/* Section 4: Connect With Us */}
                <div className="col-span-2 md:col-span-2">
                    <h4 className="font-semibold mb-4 text-gray-200">Connect With Us</h4>
                    <div className="flex space-x-4 text-2xl">
                        {/* Placeholder Social Icons */}
                        <a className="text-gray-400 hover:text-cyan-400 transition">f</a>
                        <a className="text-gray-400 hover:text-cyan-400 transition">t</a>
                        <a className="text-gray-400 hover:text-cyan-400 transition">in</a>
                    </div>
                </div>
            </div>
            <div className="mt-6 text-center text-gray-500 text-sm">
                &copy; {new Date().getFullYear()} Service Connect. All rights reserved.
            </div>
        </div>
    </footer>
);

export const DashboardLayout = ({ children, navItems, activeTab, setActiveTab, title }) => {
    const { user } = useAuth();
    return (
        <div className="bg-gray-50 min-h-screen">
            <div className="container mx-auto px-6 py-10">
                <h1 className="text-3xl font-extrabold text-slate-800 mb-2">{title}</h1>
                <p className="text-gray-500 mb-8">Logged in as: <span className="font-medium text-slate-700">{user?.email || 'N/A'} ({user?.role})</span></p>
                <div className="flex flex-col md:flex-row gap-8">
                    <aside className="md:w-1/4">
                        <nav className="bg-white rounded-xl shadow-lg p-4 border border-gray-200 sticky top-24">
                            <ul>
                               {navItems.map(item => (
                                    <li key={item.tab} className="mb-1">
                                         <a
                                             onClick={() => setActiveTab(item.tab)}
                                             className={`block px-4 py-3 rounded-lg cursor-pointer transition-colors text-lg ${activeTab === item.tab ? `${DARK_CYAN_CLASS} text-white font-bold shadow-md` : 'text-slate-700 hover:bg-cyan-50 hover:text-cyan-700'}`}
                                         >
                                             {item.label}
                                         </a>
                                     </li>
                                ))}
                            </ul>
                        </nav>
                    </aside>
                    <main className="md:w-3/4">
                        <div className="bg-white rounded-xl shadow-lg p-6 min-h-[500px] border border-gray-200">
                            {children}
                        </div>
                    </main>
                </div>
            </div>
        </div>
    );
};