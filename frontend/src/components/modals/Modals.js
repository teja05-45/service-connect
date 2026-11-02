// frontend/src/components/modals/Modals.js

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
    API_BASE_URL, 
    CURRENCY_SYMBOL, 
    DARK_CYAN_CLASS, 
    DARK_CYAN_HOVER_CLASS,
    DARK_CYAN_TEXT_CLASS,
    getProfileField 
} from '../../pages/utils/helpers';
import { ErrorMessage, SuccessMessage, Spinner } from '../shared/UI';


export const Modal = ({ title, children, onClose }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 m-4 relative">
            <h2 className="text-2xl font-bold text-slate-800 mb-4 border-b pb-2">{title}</h2>
            <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-xl font-bold transition">
                &times;
            </button>
            {children}
        </div>
    </div>
);


export const SetPriceModal = ({ booking, onClose, onPriceSet }) => {
    const { token } = useAuth();
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    
    const handleSetPrice = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const finalAmount = parseFloat(amount);
        if (isNaN(finalAmount) || finalAmount <= 0) {
            setError('Please enter a valid positive amount.');
            setLoading(false);
            return;
        }

        try {
            // Logic: Provider sets the price, moves status to 'awaiting_customer_confirmation'
            const response = await fetch(`${API_BASE_URL}/bookings/${booking.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                body: JSON.stringify({ status: 'accepted', amount: finalAmount }),
            });
            const data = await response.json();

            if (response.ok) {
                setSuccess(`Price of ${CURRENCY_SYMBOL}${finalAmount.toFixed(2)} set. Customer notified for confirmation.`);
                setTimeout(() => onPriceSet(), 2000);
            } else {
                setError(data.error || 'Failed to set price.');
            }
        } catch (err) {
            setError('Network error occurred.');
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <Modal title={`Set Price for Booking #${booking.id}`} onClose={onClose}>
            <p className="text-gray-600 mb-4">Set the final service price. The customer must confirm this price before the booking status moves to 'Accepted'.</p>
            {error && <ErrorMessage message={error} />}
            {success && <SuccessMessage message={success} />}
            <form onSubmit={handleSetPrice} className="space-y-4">
                 <div>
                    <label htmlFor="amount" className="block text-sm font-semibold text-gray-700">Final Price ({CURRENCY_SYMBOL})</label>
                    <input 
                        id="amount" 
                        name="amount" 
                        type="number" 
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required 
                        className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg text-lg" 
                        placeholder="e.g., 5000.00"
                    />
                </div>
                <button type="submit" disabled={loading} className={`w-full ${DARK_CYAN_CLASS} text-white font-bold py-3 rounded-lg ${DARK_CYAN_HOVER_CLASS} transition disabled:bg-gray-400`}>
                    {loading ? 'Submitting Price...' : 'Submit Price & Await Confirmation'}
                </button>
            </form>
        </Modal>
    );
};


export const BookingModal = ({ provider, service, onClose, onBooked, navigate }) => { 
    const { token, user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleBookingSuccess = () => {
        onClose();
        navigate('customerDashboard');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        
        const bookingData = {
            provider_id: provider.id,
            service_id: service.id,
            scheduled_at: e.target.scheduled_at.value,
            address: e.target.address.value,
            customer_notes: e.target.customer_notes.value,
            service_description: e.target.service_description.value, 
        };

        try {
            const response = await fetch(`${API_BASE_URL}/bookings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                body: JSON.stringify(bookingData),
            });
            const data = await response.json();

            if (response.ok) {
                setSuccess(`Request sent! ID: ${data.booking_id}. Provider will review shortly.`);
                setTimeout(() => handleBookingSuccess(), 2000); 
            } else {
                setError(data.error || 'Failed to send booking request.');
            }
        } catch (err) {
            setError('Network error occurred during booking.');
        } finally {
            setLoading(false);
        }
    };

    if (!user) return <ErrorMessage message="You must be logged in to book a service." />;

    // Use default location from user profile
    const defaultLat = getProfileField(user, 'location_lat', 'N/A');
    const defaultLon = getProfileField(user, 'location_lon', 'N/A');
    const defaultAddress = getProfileField(user, 'address_line_1', '');
    const defaultCity = getProfileField(user, 'city', '');
    const fullAddress = defaultAddress + (defaultCity ? `, ${defaultCity}` : '');

    return (
        <Modal title={`Book ${service.name} with ${provider.display_name}`} onClose={onClose}>
            {error && <ErrorMessage message={error} />}
            {success && <SuccessMessage message={success} />}
            <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm text-gray-600">**Important:** Your default location is set to ({defaultLat}, {defaultLon}). Update it in your dashboard if needed.</p>
                <div>
                    <label htmlFor="scheduled_at" className="block text-sm font-semibold text-gray-700">Scheduled Date & Time</label>
                    <input id="scheduled_at" name="scheduled_at" type="datetime-local" required className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg" />
                </div>
                <div>
                    <label htmlFor="address" className="block text-sm font-semibold text-gray-700">Service Address</label>
                    <input id="address" name="address" type="text" defaultValue={fullAddress} required className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg" />
                </div>
                 <div>
                    <label htmlFor="service_description" className="block text-sm font-semibold text-gray-700">Detailed Service Description (What do you need done?)</label>
                    <textarea id="service_description" name="service_description" rows="3" required className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="e.g., Leaking faucet in the kitchen sink. Requires immediate attention."></textarea>
                </div>
                <div>
                    <label htmlFor="customer_notes" className="block text-sm font-semibold text-gray-700">Additional Notes (Optional)</label>
                    <textarea id="customer_notes" name="customer_notes" rows="2" className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg"></textarea>
                </div>
                <button type="submit" disabled={loading} className={`w-full ${DARK_CYAN_CLASS} text-white font-bold py-3 rounded-lg ${DARK_CYAN_HOVER_CLASS} transition disabled:bg-gray-400`}>
                    {loading ? 'Sending Request...' : 'Confirm & Send Request'}
                </button>
            </form>
        </Modal>
    );
};

export const ReviewAndPaymentModal = ({ booking, onClose, onCompleted }) => {
    const { token } = useAuth();
    const [rating, setRating] = useState(0); 
    const [comment, setComment] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);
    const [isPaid, setIsPaid] = useState(booking.booking_status === 'closed');
    const [isReviewed, setIsReviewed] = useState(false); 
    
    useEffect(() => {
        setIsPaid(booking.booking_status === 'closed');
        // A simple assumption that if status is closed, it's paid. 
        // A more robust check would involve fetching the review status.
    }, [booking.booking_status]);

    const handlePayment = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE_URL}/payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                body: JSON.stringify({ booking_id: booking.id }), 
            });
            const data = await response.json();

            if (response.ok) {
                setSuccess(`Payment successful! Amount debited from your wallet. You can now optionally leave a review.`);
                setIsPaid(true);
                onCompleted(); 
            } else {
                setError(data.error || 'Payment failed. Check your wallet balance.');
            }
        } catch (err) {
            setError('Network error during payment processing.');
        } finally {
            setLoading(false);
        }
    };
    
    const handleReviewSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');

        if (!isPaid) {
            setError('Please complete the payment first before submitting a review.');
            setLoading(false);
            return;
        }
        if (!rating) {
            setError('Please choose a rating between 1 and 5 stars.');
            setLoading(false);
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/reviews`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                body: JSON.stringify({ 
                    booking_id: booking.id, 
                    rating: rating, 
                    comment: comment 
                }),
            });
            const data = await response.json();
            
            if (response.ok) {
                setSuccess(data.message);
                setIsReviewed(true);
                onCompleted(); 
            } else {
                setError(data.error || 'Review submission failed. This booking may already be reviewed.');
            }
        } catch (err) {
            setError('Network error during review submission.');
        } finally {
            setLoading(false);
        }
    };
    
    // Star rating component for re-use
    const StarRating = () => (
        <div className="flex justify-center space-x-1">
            {[1, 2, 3, 4, 5].map((star) => (
                <span 
                    key={star} 
                    onClick={() => setRating(star)}
                    className={`cursor-pointer text-3xl transition ${star <= rating ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'}`}
                >
                    &#9733;
                </span>
            ))}
        </div>
    );
    
    const isPaymentPending = booking.booking_status === 'completed' && !isPaid;
    const isReadyToReview = isPaid && !isReviewed && booking.booking_status === 'closed'; // Only allow review if paid AND closed (final status)

    return (
        <Modal title={`Payment & Review for Booking #${booking.id}`} onClose={onClose}>
            {error && <ErrorMessage message={error} />}
            {success && <SuccessMessage message={success} />}

            {/* --- Payment Section (Only visible if not yet paid) --- */}
            {isPaymentPending && (
                <div className="bg-red-50 p-4 rounded-lg mb-4 border border-red-200">
                    <h3 className="text-xl font-bold text-red-700 mb-3">1. Complete Payment (Required)</h3>
                    <p className="mb-3 text-gray-700">
                        Final Service Fee: **{CURRENCY_SYMBOL}{parseFloat(booking.amount || 0).toFixed(2)}**
                    </p>
                    <button onClick={handlePayment} disabled={loading} className="w-full bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 transition disabled:bg-gray-400">
                        {loading ? 'Processing...' : `Pay ${CURRENCY_SYMBOL}${parseFloat(booking.amount || 0).toFixed(2)} from Wallet`}
                    </button>
                </div>
            )}
            
            {/* --- Review Section (Only visible after successful payment or if already paid) --- */}
            {isReadyToReview && (
                <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
                    <h3 className="text-xl font-bold text-amber-700 mb-3">2. Optional Review</h3>
                    <form onSubmit={handleReviewSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2 text-center">Your Rating</label>
                            <StarRating />
                            <p className="text-center text-sm text-gray-500 mt-1">({rating} out of 5)</p>
                        </div>
                        <div>
                            <label htmlFor="comment" className="block text-sm font-semibold text-gray-700">Comment (Optional)</label>
                            <textarea id="comment" name="comment" rows="3" value={comment} onChange={(e) => setComment(e.target.value)} className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="Share your experience..."></textarea>
                        </div>
                        <button type="submit" disabled={loading || rating < 1} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400">
                            {loading ? 'Submitting...' : 'Submit Review (Optional)'}
                        </button>
                    </form>
                </div>
            )}
            
            {(booking.booking_status === 'closed' && !isReadyToReview) && (
                <SuccessMessage message="This booking is closed and payment is complete. You may have already submitted a review." />
            )}
            
            <div className="mt-4 text-right">
                <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 font-medium">Close</button>
            </div>

        </Modal>
    );
};

export const PriceConfirmationModal = ({ booking, onClose, onConfirmed }) => {
    const { token } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleConfirm = async (accepted) => {
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE_URL}/bookings/${booking.id}/confirm-price`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                body: JSON.stringify({ accepted }),
            });
            const data = await response.json();

            if (response.ok) {
                setSuccess(data.message);
                setTimeout(() => onConfirmed(), 2000); 
            } else {
                setError(data.error || 'Failed to process confirmation.');
            }
        } catch (err) {
            setError('Network error occurred.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal title={`Confirm Price for Booking #${booking.id}`} onClose={onClose}>
            {error && <ErrorMessage message={error} />}
            {success && <SuccessMessage message={success} />}
            
            <div className="space-y-4">
                <p className="text-lg text-slate-800 font-semibold">
                    Provider's Quoted Price: 
                    <span className="text-green-600 ml-2 text-2xl font-bold">{CURRENCY_SYMBOL}{parseFloat(booking.amount || 0).toFixed(2)}</span>
                </p>
                <p className="text-gray-600">
                    If you accept, the service will be officially **Accepted**, and the chat will open for coordination. If you reject, the booking will be **Rejected** and cancelled.
                </p>
                
                <div className="flex space-x-4 pt-4">
                    <button 
                        onClick={() => handleConfirm(true)} 
                        disabled={loading}
                        className="flex-1 bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 transition disabled:bg-gray-400"
                    >
                        {loading ? 'Confirming...' : 'Accept Price'}
                    </button>
                    <button 
                        onClick={() => handleConfirm(false)} 
                        disabled={loading}
                        className="flex-1 bg-red-500 text-white font-bold py-3 rounded-lg hover:bg-red-600 transition disabled:bg-gray-400"
                    >
                        Reject Price
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export const ChatComponent = ({ booking, onClose, isCustomer }) => {
    const { token, user, markMessagesAsRead } = useAuth();
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [file, setFile] = useState(null); 
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [sendLoading, setSendLoading] = useState(false);
    
    const messagesEndRef = React.useRef(null);
    
    const fetchMessages = useCallback(async () => {
        setError('');
        try {
            const res = await fetch(`${API_BASE_URL}/bookings/${booking.id}/messages`, { 
                headers: { 'x-auth-token': token },
            });
            const data = await res.json();
            
            if (res.ok) {
                setMessages(data.messages || []);
            } else {
                setError(data.error || 'Failed to load chat history.');
            }
        } catch (err) {
            setError('Network error occurred during chat loading.');
        } finally {
            setLoading(false);
        }
    }, [booking.id, token]);

    useEffect(() => {
        setLoading(true);
        fetchMessages();
        markMessagesAsRead(booking.id); 
        
        const interval = setInterval(fetchMessages, 5000); 
        return () => clearInterval(interval);
        
    }, [fetchMessages, booking.id, markMessagesAsRead]);
    
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        
        if (!newMessage.trim() && !file) return;
        if (!token) return;
        
        setSendLoading(true);
        setError('');
        
        // Optimistic update
        const contentToSend = file ? `Uploading ${file.name}...` : newMessage.trim();
        
        setMessages(prev => [...prev, { 
            id: Date.now(), 
            sender_id: user.id, 
            sender_email: user.email,
            content: contentToSend, 
            file_url: file ? 'pending' : null,
            created_at: new Date().toISOString() 
        }]);
        setNewMessage('');
        
        let response;
        try {
            if (file) {
                // File Upload
                const formData = new FormData();
                formData.append('file', file);
                
                response = await fetch(`${API_BASE_URL}/bookings/${booking.id}/messages/upload`, {
                    method: 'POST',
                    headers: { 'x-auth-token': token },
                    body: formData,
                });
                setFile(null); // Clear file after submission attempt
            } else {
                // Text Message
                response = await fetch(`${API_BASE_URL}/bookings/${booking.id}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                    body: JSON.stringify({ content: contentToSend }),
                });
            }

            if (!response.ok) {
                const errorData = await response.json();
                setError(errorData.error || 'Failed to send message/file.');
            } 
            
            // Refresh messages after send (polling will pick it up, but force-fetch for faster update)
            fetchMessages();
            
        } catch (err) {
            console.error('Network error during send:', err);
            setError('Network error occurred while sending message.');
        } finally {
            setSendLoading(false);
        }
    };
    
    const chatTitle = isCustomer 
        ? `Chat with ${booking.provider_name}`
        : `Chat with Customer (${booking.customer_email})`;
        
    const isChatActive = booking.booking_status === 'accepted' || booking.booking_status === 'closed' || booking.booking_status === 'completed';

    const renderFileContent = (msg) => {
        if (!msg.file_url) return null;

        const isImage = /\.(jpe?g|png|gif|webp)$/i.test(msg.file_url); 
        const fileName = msg.content.replace('File uploaded: ', '');

        return (
            <div className="mb-2 p-2 bg-white rounded-lg border border-gray-300">
                <p className="text-xs font-medium text-blue-600 mb-1">
                    Attached File
                </p>
                {isImage ? (
                     <img 
                        src={msg.file_url} 
                        alt="Attachment" 
                        className="max-w-full h-auto rounded-md cursor-pointer"
                    />
                ) : (
                    <p className="text-sm text-blue-500 truncate block font-mono">
                        {fileName}
                    </p>
                )}
                {/* Fallback for file messages without content */}
                <p className="text-sm mt-1">{msg.content}</p>
            </div>
        );
    }

    return (
        <Modal title={chatTitle} onClose={onClose}>
            {error && <ErrorMessage message={error} />}
            <div className="h-96 flex flex-col border border-gray-200 rounded-lg overflow-hidden">
                {/* Messages Window */}
                <div className="flex-grow p-4 overflow-y-auto bg-gray-50 space-y-3">
                    {loading ? (
                        <Spinner />
                    ) : messages.length === 0 ? (
                        <p className="text-center text-gray-500 pt-10">Start a conversation!</p>
                    ) : (
                        messages.map((msg, index) => {
                            const isSender = msg.sender_id === user.id;
                            return (
                                <div key={index} className={`flex ${isSender ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-xs md:max-w-md px-4 py-2 rounded-xl shadow-md ${isSender ? `${DARK_CYAN_CLASS} text-white rounded-br-none` : 'bg-gray-200 text-slate-800 rounded-tl-none'}`}>
                                        <p className="text-xs font-semibold mb-1 opacity-75">{isSender ? 'You' : msg.sender_email}</p>
                                        
                                        {msg.file_url && renderFileContent(msg)}
                                        {!msg.file_url && <p className="text-sm">{msg.content}</p>}
                                        
                                        <span className="text-xs block mt-1 text-right opacity-75">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>
                
                {/* Input Area */}
                <form onSubmit={handleSendMessage} className="p-4 bg-white border-t flex space-x-3 items-center">
                     {/* File Input Button */}
                    <label htmlFor="file-upload" className={`text-2xl cursor-pointer p-2 rounded-full transition ${isChatActive ? `${DARK_CYAN_TEXT_CLASS} hover:bg-gray-100` : 'text-gray-400'}`}>
                        &#x1F4F7;
                    </label>
                    <input 
                        id="file-upload" 
                        type="file"
                        onChange={(e) => setFile(e.target.files[0])}
                        className="hidden"
                        disabled={!isChatActive}
                        accept="image/*,application/pdf"
                    />
                    
                    <input 
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder={isChatActive ? "Type your message..." : "Chat is disabled until accepted"}
                        className="flex-grow px-4 py-2 border border-gray-300 rounded-lg focus:ring-cyan-500 focus:border-cyan-500"
                        disabled={!isChatActive || sendLoading || !!file}
                    />
                    
                    {file && (
                        <div className="text-sm bg-blue-100 p-2 rounded-lg flex items-center space-x-2">
                            <span>{file.name.length > 10 ? file.name.substring(0, 7) + '...' : file.name}</span>
                            <button type="button" onClick={() => setFile(null)} className="text-red-500 font-bold hover:text-red-700">&times;</button>
                        </div>
                    )}
                    
                    <button 
                        type="submit" 
                        className={`${DARK_CYAN_CLASS} text-white px-6 py-2 rounded-lg font-bold ${DARK_CYAN_HOVER_CLASS} transition disabled:bg-gray-400`}
                        disabled={(!newMessage.trim() && !file) || !isChatActive || sendLoading}
                    >
                        {sendLoading ? 'Sending...' : 'Send'}
                    </button>
                </form>
            </div>
            {!isChatActive && <p className="text-center text-sm text-red-500 mt-2">Chat is only active when the booking status is 'accepted', 'completed', or 'closed'.</p>}
        </Modal>
    );
};