import React from 'react';
import { DARK_CYAN_CLASS, DARK_CYAN_HOVER_CLASS,DARK_CYAN_TEXT_CLASS,CURRENCY_SYMBOL, formatDistance } from '../../pages/utils/helpers';

export const ServiceCard = ({ service, onClick }) => (
  <div
    onClick={() => onClick(service)}
    className="bg-white p-4 rounded-xl shadow-md hover:shadow-lg transform hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col items-center text-center border border-gray-200 group"
  >
    {/* Service Image */}
    <img
      src={service.icon_url}
      alt={service.name}
      className="w-20 h-20 object-cover rounded-full mb-3 shadow-md border border-gray-200 group-hover:scale-110 transition-all duration-300"
    />

    {/* Service Name */}
    <h3 className="text-md font-bold text-slate-800 mb-1 group-hover:text-blue-600">
      {service.name}
    </h3>

    {/* Service Description */}
    <p className="text-gray-500 text-xs line-clamp-1">
      {service.description || 'Professional Service'}
    </p>
  </div>
);

export const ProviderCard = ({ provider, onClick }) => (
    <div onClick={() => onClick(provider)} className="bg-white rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-300 cursor-pointer flex flex-col p-4 space-y-3 border border-gray-200 min-w-[280px]">
        
        <div className="flex items-center space-x-3">
            <img className="w-16 h-16 rounded-full object-cover shadow-md" 
                src={provider.profile_picture_url || `https://placehold.co/150x150/E0E7FF/4338CA?text=${provider.display_name.charAt(0)}`} 
                alt={provider.display_name} 
            />
            <div className="flex-grow">
                <div className="flex items-center space-x-2">
                    <h3 className="text-lg font-bold text-slate-800">{provider.display_name}</h3>
                    {provider.is_verified && <span title="Verified Professional" className="bg-green-100 text-green-800 text-xs font-semibold px-1 py-0.5 rounded-full border border-green-300">✓</span>}
                </div>
                <p className="text-xs font-semibold text-gray-500">{provider.service_name || 'Service Expert'}</p>
                {formatDistance(provider.distance_km) && (
                    <p className="text-xs text-cyan-700 font-semibold mt-1">
                        📍 {formatDistance(provider.distance_km)} away
                    </p>
                )}
            </div>
        </div>

        <div className="flex justify-between items-center border-t pt-3">
            <div className="flex items-center text-sm">
                <span className="text-amber-500 mr-1 text-lg font-extrabold">{parseFloat(provider.average_rating || 0).toFixed(1)}/5</span>
                <span className="ml-2 text-gray-500 text-xs">({provider.review_count || 0} reviews)</span>
            </div>
            <button className={`${DARK_CYAN_CLASS} text-white text-xs font-semibold px-4 py-1.5 rounded-lg ${DARK_CYAN_HOVER_CLASS} transition`}>
                View Profile
            </button>
        </div>
    </div>
);


export const BookingCard = ({ booking, handleAction, isCustomer, onReviewModalOpen, onChatModalOpen, onPriceConfirmationOpen, onSetPriceOpen }) => {
    // Helper to determine color based on status
    const getStatusClasses = (status) => {
        switch (status) {
            case 'pending_provider': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
            case 'awaiting_customer_confirmation': return 'bg-purple-100 text-purple-800 border-purple-300 animate-pulse'; 
            case 'accepted': return 'bg-blue-100 text-blue-800 border-blue-300';
            case 'completed': return 'bg-red-100 text-red-800 border-red-300'; // Completed/Unpaid
            case 'closed': return 'bg-green-100 text-green-800 border-green-300'; // Paid/Closed
            case 'rejected': return 'bg-gray-200 text-gray-700 border-gray-400';
            default: return 'bg-gray-100 text-gray-600 border-gray-300';
        }
    };
    
    // Determine title based on role
    const title = isCustomer 
        ? `Provider: ${booking.provider_name || 'N/A'}`
        : `Customer: ${booking.customer_email || 'N/A'}`;
        
    const secondaryInfo = isCustomer 
        ? `Service: ${booking.service_name || 'N/A'}`
        : `Service: ${booking.service_name || 'N/A'}`;
        
    // FIX: Using CURRENCY_SYMBOL from imports instead of hardcoded '₹'
    const amountDisplay = booking.amount ? `${CURRENCY_SYMBOL}${parseFloat(booking.amount).toFixed(2)}` : 'N/A';
    
    // Customer Actions
    const customerActions = (
        <div className="flex flex-col space-y-3">
            
            {/* Price Confirmation */}
            {booking.booking_status === 'awaiting_customer_confirmation' && (
                <button 
                    className="text-white px-4 py-2 rounded-lg font-semibold transition shadow-md bg-purple-600 hover:bg-purple-700"
                    onClick={() => onPriceConfirmationOpen(booking)}
                >
                    Review Price: {amountDisplay}
                </button>
            )}

            {/* Review & Payment button */}
            {/* FIX: Show button if status is 'completed' (for payment) OR 'closed' (for review) */}
            {(booking.booking_status === 'completed' || booking.booking_status === 'closed') && (
                 <button 
                    className="text-white px-4 py-2 rounded-lg font-semibold transition shadow-md bg-red-500 hover:bg-red-600"
                    onClick={() => onReviewModalOpen(booking)}
                >
                    {/* Dynamic text: 'Pay & Review' OR 'Leave/View Review' */}
                    {booking.booking_status === 'completed' ? 'Pay & Review' : 'Leave/View Review'}
                </button>
            )}
            
            {/* Chat button */}
            {(booking.booking_status === 'accepted' || booking.booking_status === 'closed' || booking.booking_status === 'completed') && (
                 <button 
                    className={`${DARK_CYAN_CLASS} text-white px-4 py-2 rounded-lg font-semibold ${DARK_CYAN_HOVER_CLASS} transition shadow-md`}
                    onClick={() => onChatModalOpen(booking)}
                >
                    Chat Now
                </button>
            )}
        </div>
    );
    
    // Provider Actions
    const providerActions = (
        <div className="flex flex-col space-y-3">
             {booking.booking_status === 'pending_provider' && (
                <div className="flex space-x-3">
                    <button 
                        onClick={() => onSetPriceOpen(booking)} 
                        className="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition shadow-md"
                    >
                        Set Price & Accept
                    </button>
                    <button 
                        onClick={() => handleAction(booking.id, 'rejected')} 
                        className="bg-red-500 text-white px-4 py-2 rounded-lg font-semibold hover:bg-red-600 transition shadow-md"
                    >
                        Reject
                    </button>
                </div>
            )}
            
            {booking.booking_status === 'awaiting_customer_confirmation' && (
                <p className="text-purple-600 font-semibold text-center p-2 border border-purple-300 rounded-lg">Awaiting Customer Confirmation ({amountDisplay})</p>
            )}
            
            {booking.booking_status === 'accepted' && (
                 <div className="space-y-3">
                    <button 
                        onClick={() => handleAction(booking.id, 'completed')} 
                        className="bg-red-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-red-700 transition shadow-md"
                    >
                        Mark Completed (Awaiting Payment)
                    </button>
                    <button 
                        className={`${DARK_CYAN_CLASS} text-white px-4 py-2 rounded-lg font-semibold ${DARK_CYAN_HOVER_CLASS} transition shadow-md`}
                        onClick={() => onChatModalOpen(booking)}
                    >
                        Chat Now
                    </button>
                 </div>
            )}

            {(booking.booking_status === 'completed' || booking.booking_status === 'closed') && (
                 <button 
                    className={`${DARK_CYAN_CLASS} text-white px-4 py-2 rounded-lg font-semibold ${DARK_CYAN_HOVER_CLASS} transition shadow-md`}
                    onClick={() => onChatModalOpen(booking)}
                >
                    Chat Now / View
                </button>
            )}
            
            {(booking.booking_status === 'completed' || booking.booking_status === 'closed') && (
                <p className={`font-semibold text-sm text-center p-2 rounded-lg ${booking.booking_status === 'completed' ? 'text-red-500 bg-red-100' : 'text-green-600 bg-green-100'}`}>
                    Status: {booking.booking_status === 'completed' ? 'Awaiting Customer Payment' : 'PAID & CLOSED'}
                </p>
            )}

        </div>
    );

    
    return (
        <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-6 mb-4 flex flex-col md:flex-row justify-between items-start md:items-center">
            <div className="flex-grow space-y-2">
                <div className="flex items-center space-x-3">
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${getStatusClasses(booking.booking_status)} uppercase`}>
                        {booking.booking_status.replace('_', ' ')}
                    </span>
                    <p className="text-sm text-gray-500">Request ID: <span className="font-mono">{booking.id}</span></p>
                </div>
                
                <h3 className="text-xl font-bold text-slate-800">{title}</h3>
                
                <div className="text-gray-600 text-sm">
                    <p className="font-medium text-slate-800">{secondaryInfo}</p>
                    <p>📅 **Scheduled:** {new Date(booking.scheduled_at).toLocaleString()}</p>
                    <p>📍 **Location:** {booking.address}</p>
                    {(booking.amount && booking.booking_status !== 'pending_provider') && <p className="font-bold text-blue-600">💰 **Price:** {amountDisplay}</p>}
                    {booking.service_description && (
                        <p className={`mt-2 p-2 bg-gray-50 border-l-4 ${DARK_CYAN_TEXT_CLASS.replace('text', 'border')}`}>Description: {booking.service_description}</p>
                    )}
                    {booking.customer_notes && (
                        <p className="mt-2 p-2 bg-gray-50 border-l-4 border-blue-400 italic">Notes: {booking.customer_notes}</p>
                    )}
                </div>
            </div>
            
            <div className="mt-4 md:mt-0">
                {isCustomer ? customerActions : providerActions}
            </div>
        </div>
    );
};
