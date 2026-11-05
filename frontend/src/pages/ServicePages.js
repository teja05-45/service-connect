// frontend/src/pages/ServicePages.js

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { ServiceCard, ProviderCard } from '../components/shared/Cards';
import { Spinner, ErrorMessage, SuccessMessage, ErrorState } from '../components/shared/UI';
import { BookingModal } from '../components/modals/Modals';
import { 
    API_BASE_URL, 
    DARK_CYAN_CLASS, 
    DARK_CYAN_HOVER_CLASS,
    DARK_CYAN_TEXT_CLASS,
    SEARCH_RADIUS_OPTIONS,
    getSavedLocation,
    formatCoordinates,
    isValidLatitude,
    isValidLongitude,
    requestBrowserLocation
} from './utils/helpers';

export const AllServicesPage = ({ setPage, setSelectedService, searchParams }) => {
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchServices = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/services`);
                if (!res.ok) throw new Error('Failed to fetch services. Is the backend running?');
                let data = await res.json();
                
                // Mock filtering by query (since backend only filters by service ID)
                if (searchParams?.query) {
                    const query = searchParams.query.toLowerCase();
                    data = data.filter(s => s.name.toLowerCase().includes(query) || (s.description || '').toLowerCase().includes(query));
                }
                
                setServices(data || []);
            } catch (err) {
                setError(err.message || 'Failed to load services.');
            } finally {
                setLoading(false);
            }
        };
        fetchServices();
    }, [searchParams]);

    const handleServiceClick = (service) => {
        setSelectedService(service);
        setPage('serviceProviders');
    };
    
    return (
        <div className="container mx-auto px-6 py-16">
            <a onClick={() => setPage('home')} className="text-blue-600 hover:text-blue-800 font-medium transition mb-8 flex items-center cursor-pointer">&larr; Back to Home</a>
            <h1 className="text-4xl font-bold text-slate-800 mb-4 text-center border-b pb-4">All Available Services</h1>
             {searchParams?.query && (
                 <p className="text-center text-lg text-gray-600 mb-8">Showing results for: <strong>"{searchParams.query}"</strong></p>
             )}
            {loading && <Spinner />}
            {error && <ErrorMessage message={error} />}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8 mt-6">
                {(services || []).map(service => (
                    <ServiceCard key={service.id} service={service} onClick={handleServiceClick} />
                ))}
            </div>
        </div>
    );
};

/**
 * Provider discovery.
 *
 * Location rules:
 *   - a saved profile location is used first,
 *   - the customer can share the browser location (permission prompt) or enter
 *     coordinates manually,
 *   - with no location, approved providers for the category are still listed
 *     but explicitly labelled as unfiltered - we never pretend (0,0) is real.
 */
export const ServiceProvidersPage = ({ service, setPage, setSelectedProvider }) => {
    const { user, token, isAuthenticated, fetchUserProfile } = useAuth();
    const savedLocation = isAuthenticated ? getSavedLocation(user) : null;

    const [location, setLocation] = useState(savedLocation);
    const [locationSource, setLocationSource] = useState(savedLocation ? 'saved' : null);
    const [manualLat, setManualLat] = useState(savedLocation ? String(savedLocation.lat) : '');
    const [manualLon, setManualLon] = useState(savedLocation ? String(savedLocation.lon) : '');
    const [radius, setRadius] = useState(10);
    const [maxRadius, setMaxRadius] = useState(50);
    const [locating, setLocating] = useState(false);
    const [savingLocation, setSavingLocation] = useState(false);
    const [locationError, setLocationError] = useState('');
    const [locationNotice, setLocationNotice] = useState('');

    const [providers, setProviders] = useState([]);
    const [searchMeta, setSearchMeta] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // The profile is fetched asynchronously by AuthContext; adopt a saved
    // location that arrives after the first render (once, only if nothing is set).
    useEffect(() => {
        if (location || !savedLocation) return;
        setLocation(savedLocation);
        setLocationSource('saved');
        setManualLat(String(savedLocation.lat));
        setManualLon(String(savedLocation.lon));
    }, [savedLocation, location]);

    const fetchProviders = useCallback(async () => {
        if (!service || !service.id) {
            setError('No service selected. Please go back and choose a service category.');
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({
                service_id: String(service.id),
                radius: String(radius),
            });
            if (location) {
                params.set('lat', String(location.lat));
                params.set('lon', String(location.lon));
            }

            const res = await fetch(`${API_BASE_URL}/providers?${params.toString()}`);
            const body = await res.json().catch(() => ({}));

            if (!res.ok) {
                throw new Error(body.error || `Provider search failed (HTTP ${res.status}).`);
            }

            setProviders(Array.isArray(body.providers) ? body.providers : []);
            setSearchMeta(body.search || null);
            if (body.search?.max_radius_km) setMaxRadius(body.search.max_radius_km);
        } catch (err) {
            setProviders([]);
            setError(err.message || 'Could not load providers. Check that the API is running and try again.');
        } finally {
            setLoading(false);
        }
    }, [service, radius, location]);

    useEffect(() => {
        fetchProviders();
    }, [fetchProviders]);

    const useBrowserLocation = async () => {
        setLocationError('');
        setLocationNotice('');
        setLocating(true);
        try {
            const next = await requestBrowserLocation();
            setLocation({ lat: next.lat, lon: next.lon });
            setLocationSource('browser');
            setManualLat(next.lat.toFixed(6));
            setManualLon(next.lon.toFixed(6));
            setLocationNotice(
                next.accuracy_m
                    ? `Using your browser location (accurate to about ${Math.round(next.accuracy_m)} m). You can save it to your profile.`
                    : 'Using your browser location. You can save it to your profile.'
            );
        } catch (err) {
            setLocationError(err.message);
        } finally {
            setLocating(false);
        }
    };

    const applyManualLocation = () => {
        setLocationError('');
        setLocationNotice('');
        const lat = Number(manualLat);
        const lon = Number(manualLon);

        if (!isValidLatitude(lat)) {
            setLocationError('Latitude must be a number between -90 and 90.');
            return;
        }
        if (!isValidLongitude(lon)) {
            setLocationError('Longitude must be a number between -180 and 180.');
            return;
        }
        if (lat === 0 && lon === 0) {
            setLocationError('(0, 0) is not a real location. Enter your actual latitude and longitude.');
            return;
        }

        setLocation({ lat, lon });
        setLocationSource('manual');
        setLocationNotice('Using the location you entered.');
    };

    const saveLocationToProfile = async () => {
        if (!token || !location) return;
        setSavingLocation(true);
        setLocationError('');
        setLocationNotice('');
        try {
            const res = await fetch(`${API_BASE_URL}/user/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                body: JSON.stringify({
                    email: user.email,
                    location_lat: location.lat,
                    location_lon: location.lon,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'Could not save your location.');

            if (fetchUserProfile) await fetchUserProfile(token);
            setLocationSource('saved');
            setLocationNotice('Location saved to your profile.');
        } catch (err) {
            setLocationError(err.message);
        } finally {
            setSavingLocation(false);
        }
    };

    const clearLocation = () => {
        setLocation(null);
        setLocationSource(null);
        setLocationNotice('');
        setLocationError('');
        setManualLat('');
        setManualLon('');
    };

    const handleProviderClick = (provider) => {
        setSelectedProvider(provider);
        setPage('providerDetail');
    };

    const radiusChoices = [...new Set([...SEARCH_RADIUS_OPTIONS, radius, maxRadius])]
        .filter((value) => value <= maxRadius)
        .sort((a, b) => a - b);

    return (
        <div className="container mx-auto px-6 py-16">
            <a onClick={() => setPage('allServices')} className="text-blue-600 hover:text-blue-800 font-medium transition mb-8 flex items-center cursor-pointer">&larr; Back to Services</a>
            <h1 className="text-4xl font-extrabold text-slate-800 mb-2">{service?.name || "Service Providers"}</h1>
            <p className="text-lg text-gray-600 mb-6 max-w-3xl">{service?.description}</p>

            {/* --- Search location panel --- */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 mb-8 max-w-4xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Search location</h2>
                        <p className="text-sm text-gray-600 mt-1">
                            {location
                                ? `Searching within ${radius} km of ${formatCoordinates(location)}${locationSource === 'saved' ? ' (saved location)' : ''}.`
                                : 'No location selected. Approved providers are listed without a distance filter.'}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <label htmlFor="radius" className="text-sm font-semibold text-gray-700">Radius</label>
                        <select
                            id="radius"
                            value={radius}
                            onChange={(e) => setRadius(Number(e.target.value))}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                            {radiusChoices.map((value) => (
                                <option key={value} value={value}>{value} km</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3 mt-4">
                    <button
                        type="button"
                        onClick={useBrowserLocation}
                        disabled={locating}
                        className={`${DARK_CYAN_CLASS} text-white text-sm font-semibold px-4 py-2 rounded-lg ${DARK_CYAN_HOVER_CLASS} disabled:bg-gray-400`}
                    >
                        {locating ? 'Reading location…' : 'Use my current location'}
                    </button>
                    {isAuthenticated && location && locationSource !== 'saved' && (
                        <button
                            type="button"
                            onClick={saveLocationToProfile}
                            disabled={savingLocation}
                            className="bg-white border border-cyan-600 text-cyan-700 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-cyan-50 disabled:opacity-60"
                        >
                            {savingLocation ? 'Saving…' : 'Save to my profile'}
                        </button>
                    )}
                    {location && (
                        <button
                            type="button"
                            onClick={clearLocation}
                            className="text-sm font-semibold text-gray-600 hover:text-red-600 px-2 py-2"
                        >
                            Clear location
                        </button>
                    )}
                </div>

                <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 mt-4 items-end">
                    <div>
                        <label htmlFor="manual-lat" className="block text-xs font-semibold text-gray-600 uppercase">Latitude</label>
                        <input
                            id="manual-lat"
                            type="number"
                            step="any"
                            value={manualLat}
                            onChange={(e) => setManualLat(e.target.value)}
                            placeholder="e.g. 16.17000"
                            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                    </div>
                    <div>
                        <label htmlFor="manual-lon" className="block text-xs font-semibold text-gray-600 uppercase">Longitude</label>
                        <input
                            id="manual-lon"
                            type="number"
                            step="any"
                            value={manualLon}
                            onChange={(e) => setManualLon(e.target.value)}
                            placeholder="e.g. 81.12999"
                            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={applyManualLocation}
                        className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-900"
                    >
                        Apply location
                    </button>
                </div>

                {locationError && <p className="mt-3 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{locationError}</p>}
                {locationNotice && <p className="mt-3 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">{locationNotice}</p>}
                <p className="mt-3 text-xs text-gray-500">
                    Only your search coordinates are sent. Your exact address is never shown to providers in search results.
                </p>
            </div>

            {loading && <Spinner />}
            {!loading && error && (
                <ErrorState
                    title="Provider search failed"
                    message={error}
                    onRetry={fetchProviders}
                />
            )}

            {!loading && !error && (
                <>
                    {searchMeta && (
                        <p className="text-sm text-gray-500 mb-4">
                            {providers.length} approved provider{providers.length === 1 ? '' : 's'}
                            {location ? ` within ${searchMeta.radius_km} km` : ' (no distance filter)'}.
                        </p>
                    )}
                    <div className="space-y-6">
                        {providers.length > 0 ? (
                            providers.map(provider => (
                                <ProviderCard key={provider.id} provider={provider} onClick={handleProviderClick} />
                            ))
                        ) : (
                            <div className="text-center text-gray-600 bg-gray-100 p-10 rounded-xl shadow-inner">
                                <p className="text-lg font-semibold mb-2">No approved providers matched this search.</p>
                                <p className="text-sm">
                                    {location
                                        ? `There are no approved providers for this service within ${radius} km of your location. Try a larger radius or a different location.`
                                        : 'There are no approved providers for this service yet. Set a location to rank the nearest providers once they are available.'}
                                </p>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export const ProviderDetailPage = ({ provider, service, setPage }) => {
    const { isAuthenticated, user } = useAuth();
    const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);

    const mockServiceName = service?.name || 'Service Professional';

    if (!provider) return <ErrorMessage message="No provider selected." />;

    const handleRequestService = () => {
        if (!isAuthenticated || user?.role !== 'customer') {
            setPage('login');
        } else {
            setIsBookingModalOpen(true);
        }
    };
    
    const handleBookingSuccess = () => {
        setIsBookingModalOpen(false);
        setPage('customerDashboard');
    };

    const serviceArea = provider.service_radius_km
        ? `Within ${provider.service_radius_km} km of the provider's service location`
        : 'Service area not specified';

    return (
        <div className="container mx-auto px-6 py-16">
            <button onClick={() => setPage('serviceProviders')} className="text-blue-600 hover:text-blue-800 font-medium transition mb-8 flex items-center">&larr; Back to Providers</button>
            
            <div className="bg-white rounded-xl shadow-2xl p-6 lg:p-10 border border-gray-200">
                
                {/* Header Section */}
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center border-b pb-6 mb-6">
                    <div className="flex items-center space-x-6">
                        <img className="w-32 h-32 rounded-full object-cover shadow-xl border-4 border-white ring-2 ring-cyan-500" 
                            src={provider.profile_picture_url || `https://placehold.co/150x150/E0E7FF/4338CA?text=${provider.display_name.charAt(0)}`} 
                            alt={provider.display_name} 
                        />
                        <div>
                            <h1 className="text-3xl font-extrabold text-slate-800">{provider.display_name}</h1>
                            <p className={`text-lg ${DARK_CYAN_TEXT_CLASS} font-semibold mb-2`}>{mockServiceName}</p>
                            <div className="flex items-center space-x-2">
                                <span className="bg-amber-100 text-amber-600 text-sm font-bold px-3 py-1 rounded-full flex items-center">
                                    <span className="text-lg mr-1">⭐</span>{parseFloat(provider.average_rating || 0).toFixed(1)}
                                </span>
                                <span className="text-gray-500 text-sm">({provider.review_count || 0} reviews)</span>
                                {provider.is_verified && <span className="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">✔️ Verified</span>}
                            </div>
                        </div>
                    </div>

                    {/* CTA Button */}
                    <button 
                        onClick={handleRequestService}
                        className={`mt-6 lg:mt-0 ${DARK_CYAN_CLASS} text-white text-lg font-bold px-8 py-3 rounded-lg ${DARK_CYAN_HOVER_CLASS} transition shadow-lg`}
                        disabled={user?.role === 'provider' || user?.role === 'admin'}
                    >
                        Request Service
                    </button>
                </div>
                
                {/* Details and Info */}
                <div className="grid md:grid-cols-3 gap-8 mb-10">
                    <div className="md:col-span-2">
                        <h2 className="text-2xl font-bold text-slate-700 mb-4 border-b pb-2">About the Professional</h2>
                        <p className="text-gray-700 leading-relaxed mb-4">{provider.bio || "This professional has not yet provided a detailed biography."}</p>
                        
                        <h3 className="text-xl font-bold text-slate-700 mb-3">Service Details</h3>
                        <ul className="list-disc list-inside text-gray-700 space-y-2">
                            <li><span className="font-semibold">Service:</span> {mockServiceName}</li>
                            <li><span className="font-semibold">Other services:</span> {(provider.services || []).length > 0 ? provider.services.join(', ') : mockServiceName}</li>
                            <li><span className="font-semibold">Service area:</span> {serviceArea}</li>
                            <li><span className="font-semibold">Pricing:</span> The provider sends a quote before any work starts.</li>
                            {provider.distance_km !== null && provider.distance_km !== undefined && (
                                <li><span className="font-semibold">Distance:</span> {provider.distance_km} km from your search location</li>
                            )}
                        </ul>
                    </div>
                </div>
            </div>
            {isBookingModalOpen && service && (
                <BookingModal 
                    provider={provider} 
                    service={service} 
                    onClose={() => setIsBookingModalOpen(false)} 
                    onBooked={handleBookingSuccess}
                    navigate={setPage}
                />
            )}
        </div>
    );
};

export const AboutPage = () => {
    return (
        <div className="bg-white">
            <div className="container mx-auto px-6 py-20">
                <div className="text-center">
                    <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4">About Service Connect</h1>
                    <p className="text-xl text-gray-600 max-w-4xl mx-auto">
                        Connecting communities with reliable local professionals. Our mission is to build trust in local services by ensuring quality, transparency, and accountability between customers and service providers.
                    </p>
                </div>

                <div className="mt-16 max-w-5xl mx-auto">
                    <h2 className="text-3xl font-bold text-slate-800 mb-6 border-b pb-2">How Service Connect Works</h2>
                    <div className="grid md:grid-cols-3 gap-8 text-left">
                        <div className="space-y-3 p-4 border rounded-xl shadow-sm">
                            <h3 className="text-xl font-semibold text-blue-600">1. Search & Book</h3>
                            <p className="text-gray-700">Customers easily find trusted local professionals by searching service categories and filtering results based on location, service radius, and ratings.</p>
                        </div>
                        <div className="space-y-3 p-4 border rounded-xl shadow-sm">
                            <h3 className="text-xl font-semibold text-blue-600">2. Quote & Acceptance</h3>
                            <p className="text-gray-700">After a booking request, the provider sends a quoted price. The customer must explicitly accept this price before the service is officially accepted and scheduled.</p>
                        </div>
                        <div className="space-y-3 p-4 border rounded-xl shadow-sm">
                            <h3 className="text-xl font-semibold text-blue-600">3. Pay & Review</h3>
                            <p className="text-gray-700">Once the service is completed, the customer pays the quoted price securely via the in-app wallet and leaves a verified review, directly impacting the provider's rating.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const ContactPage = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    
    // Mock details (based on .env context)
    const SUPPORT_EMAIL = 'support@serviceconnect.com'; // Placeholder, assuming a support email
    const PHONE_NUMBER = '+91 80 1234 5678'; // Placeholder
    const ADDRESS = 'Rgukt ongole '; // Placeholder
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');
        
        const data = {
            name: e.target.name.value,
            email: e.target.email.value,
            problem_description: e.target.problem_description.value,
        };

        try {
            const response = await fetch(`${API_BASE_URL}/contact-us`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            
            const result = await response.json();
            
            if (response.ok) {
                setSuccess(result.message);
                e.target.reset();
            } else {
                setError(result.error || 'Failed to submit message.');
            }
        } catch (err) {
            setError('Network error occurred during submission.');
        } finally {
            setLoading(false);
        }
    };


    return (
         <div className="container mx-auto px-6 py-16">
            <h1 className="text-4xl font-bold text-slate-800 mb-10 text-center border-b pb-4">Get in Touch</h1>
            
            <div className="grid md:grid-cols-3 gap-10">
                
                {/* Left/Main Section: Query Form */}
                <div className="md:col-span-2 bg-white p-8 rounded-xl shadow-lg border">
                    <h2 className="text-2xl font-semibold mb-4 text-slate-700">Send Us a Message</h2>
                    <p className="text-gray-600 mb-6">If you have any queries, suggestions, or specific problems (customer or provider), please use the form below.</p>
                    
                    {error && <ErrorMessage message={error} />}
                    {success && <SuccessMessage message={success} />}
                    
                    <form className="space-y-4" onSubmit={handleSubmit}>
                        <div>
                            <label htmlFor="name" className="block text-sm font-semibold text-gray-700">Your Name</label>
                            <input type="text" id="name" name="name" required className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg" />
                        </div>
                        <div>
                            <label htmlFor="email" className="block text-sm font-semibold text-gray-700">Your Email Address (For Admin Reply)</label>
                            <input type="email" id="email" name="email" required className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg" />
                        </div>
                        {/* Description Box for Problems/Queries */}
                        <div>
                            <label htmlFor="problem_description" className="block text-sm font-semibold text-gray-700">
                                Description of Query / Problem (e.g., Customer problem, Provider issue, Suggestion)
                            </label>
                            <textarea id="problem_description" name="problem_description" rows="5" required 
                                className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg" 
                                placeholder="Describe the issue. If it's a customer/provider problem, specify the user's name/email/ID if known."
                            ></textarea>
                        </div>
                        <button type="submit" disabled={loading} className={`w-full ${DARK_CYAN_CLASS} text-white font-bold py-3 rounded-lg ${DARK_CYAN_HOVER_CLASS} transition disabled:bg-gray-400`}>
                            {loading ? 'Submitting...' : 'Submit to Admin'}
                        </button>
                    </form>
                </div>
                
                {/* Right Section: Contact Info Sidebar */}
                <div className="md:col-span-1 space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-lg border">
                        <h3 className="text-xl font-semibold mb-4 text-slate-700">Direct Contact</h3>
                        <div className="space-y-3">
                            <p className="flex items-center text-gray-700"><span className="text-xl mr-3 text-blue-600">📧</span> <strong>Email:</strong> <a href={`mailto:${SUPPORT_EMAIL}`} className="ml-2 text-blue-600 hover:underline">{SUPPORT_EMAIL}</a></p>
                            <p className="flex items-center text-gray-700"><span className="text-xl mr-3 text-green-600">📞</span> <strong>Phone:</strong> <a href={`tel:${PHONE_NUMBER}`} className="ml-2 text-blue-600 hover:underline">{PHONE_NUMBER}</a></p>
                            <p className="flex items-center text-gray-700"><span className="text-xl mr-3 text-red-600">📍</span> <strong>Address:</strong> <span className="ml-2">{ADDRESS}</span></p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
