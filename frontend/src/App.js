// frontend/src/App.js

import React, { useState, useEffect, useCallback } from 'react';

// --- Context ---
import { AuthProvider, useAuth } from './context/AuthContext';

// --- Shared UI Components ---
// All UI components (Header, Footer, Spinner) use NAMED EXPORTS
import { Header, Footer, Spinner } from './components/shared/UI';

// --- Auth Forms ---
// All auth components use NAMED EXPORTS
import { 
    LoginPage, 
    RegisterPage, 
    ForgotPasswordPage, 
    ProviderSetupPage,
    AdminLoginPage
} from './components/auth/AuthForms';

// --- Feature Pages ---
// All pages use NAMED EXPORTS
import { HomePage } from './pages/HomePage';
import { 
    AllServicesPage, 
    ServiceProvidersPage, 
    ProviderDetailPage, 
    AboutPage, 
    ContactPage 
} from './pages/ServicePages';

// --- Dashboard Pages ---
// All dashboard components use NAMED EXPORTS
import { CustomerDashboard } from './pages/dashboards/CustomerDashboard';
import { ProviderDashboard } from './pages/dashboards/ProviderDashboard';
import { AdminDashboard } from './pages/dashboards/AdminDashboard';

const ADMIN_PATHS = {
    adminLogin: '/admin/login',
    adminDashboard: '/admin/dashboard',
};

const pageForPath = (pathname) => {
    if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin/login') {
        return 'adminLogin';
    }
    if (pathname === '/admin/dashboard') {
        return 'adminDashboard';
    }
    return 'home';
};

const AppContent = () => {
    // pageData is used to pass initial state/props for transitions (e.g., primaryServiceId after registration)
    const [page, setPage] = useState(() => pageForPath(window.location.pathname));
    const [pageData, setPageData] = useState(null);
    const [selectedService, setSelectedService] = useState(null);
    const [selectedProvider, setSelectedProvider] = useState(null);
    const [searchParams, setSearchParams] = useState(null); 
    
    // Auth context hook
    const { loading: authLoading } = useAuth(); 

    const navigate = useCallback((pageName, data = null) => {
        setPageData(data);
        setPage(pageName);
        window.scrollTo(0, 0);

        // Keep the URL meaningful for the admin area; everything else stays "/".
        const nextPath = ADMIN_PATHS[pageName] || '/';
        if (window.location.pathname !== nextPath) {
            window.history.pushState({ page: pageName }, '', nextPath);
        }
    }, []);

    // Browser back/forward support for the admin URLs.
    useEffect(() => {
        const onPopState = () => {
            setPage(pageForPath(window.location.pathname));
            window.scrollTo(0, 0);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    const renderPage = () => {
        if (authLoading) {
            return (
                <div className="flex justify-center items-center h-screen w-full bg-gray-50">
                    <Spinner />
                    <p className="ml-4 text-xl font-semibold text-slate-700">Loading Application...</p>
                </div>
            );
        }

        switch (page) {
            case 'home': 
                return <HomePage 
                    setPage={navigate} 
                    setSelectedService={setSelectedService} 
                    setSearchParams={setSearchParams} 
                    setSelectedProvider={setSelectedProvider} 
                />;
            case 'allServices': 
                return <AllServicesPage 
                    setPage={navigate} 
                    setSelectedService={setSelectedService} 
                    searchParams={searchParams} 
                />;
            case 'serviceProviders': 
                return <ServiceProvidersPage 
                    service={selectedService} 
                    setPage={navigate} 
                    setSelectedProvider={setSelectedProvider} 
                />;
            case 'providerDetail': 
                return <ProviderDetailPage 
                    provider={selectedProvider} 
                    service={selectedService} 
                    setPage={navigate} 
                />; 
            case 'about': 
                return <AboutPage />;
            case 'contact': 
                return <ContactPage />;
            case 'login': 
                return <LoginPage setPage={navigate} />;
            case 'register': 
                return <RegisterPage setPage={navigate} />;
            case 'forgotPassword': 
                return <ForgotPasswordPage setPage={navigate} />; 
            case 'providerSetup': 
                return <ProviderSetupPage setPage={navigate} pageData={pageData} />;
            case 'customerDashboard': 
                return <CustomerDashboard setPage={navigate} />; 
            case 'providerDashboard': 
                return <ProviderDashboard />;
            case 'adminLogin':
                return <AdminLoginPage setPage={navigate} />;
            case 'adminDashboard': 
                return <AdminDashboard setPage={navigate} />;
            default: 
                return <HomePage 
                    setPage={navigate} 
                    setSelectedService={setSelectedService} 
                    setSearchParams={setSearchParams} 
                    setSelectedProvider={setSelectedProvider} 
                />;
        }
    };

    // The admin area has its own chrome (sidebar/top bar) and never shows the
    // customer/provider header and footer.
    const isAdminArea = page === 'adminLogin' || page === 'adminDashboard';

    if (isAdminArea) {
        return <div className="min-h-screen bg-gray-50 font-sans">{renderPage()}</div>;
    }
    
    return (
        <div className="flex flex-col min-h-screen font-sans bg-gray-50">
            <Header setPage={navigate} />
            <main className="flex-grow">
                {renderPage()}
            </main>
            <Footer setPage={navigate} />
        </div>
    );
};

export default function App() {
    return (
        <AuthProvider>
            <AppContent />
        </AuthProvider>
    );
}
