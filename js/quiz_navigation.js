// quiz_navigation.js

// --- CONFIGURATION ---
// Get the Public Key ID from your Supabase Secrets list (e.g., rzp_test_YourKeyIDHere)
// NOTE: Use the publicly visible key ID, not the Secret.
const RAZORPAY_KEY_ID = 'rzp_test_YourPublicKeyID'; 
const API_URL_CREATE_ORDER = '/functions/v1/create-order'; // Path to your Supabase Edge Function for order creation

/**
 * Helper function to ensure the Razorpay checkout script is loaded.
 * @returns {Promise<void>} A promise that resolves when the script is loaded.
 */
function loadRazorpayScript() {
    return new new Promise((resolve) => {
        if (typeof Razorpay !== 'undefined') {
            return resolve();
        }

        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = () => resolve();
        document.head.appendChild(script);
    });
}

/**
 * Performs the actual redirection to the quiz based on the chapter name.
 * @param {string} chapterName - The cleaned chapter name.
 */
function redirectAfterPayment(chapterName) {
    // --- QUIZ REDIRECTION LOGIC (The "Roll Up" part) ---
    // This executes ONLY after a successful payment confirmation.
    
    if (chapterName.includes('4. Elasticity of Demand')) {  
        window.location.href = './quizzes/economics/microeconomics/elasticity/elasticity_quiz.html';
        return;
    }

    if (chapterName.includes("2. Consumer Equilibrium")) {  
        window.location.href = './quizzes/economics/microeconomics/equilibrium/equilibrium_quiz.html';
        return;
    }

    if (chapterName.includes('3. Demand')) {  
        window.location.href = './quizzes/economics/microeconomics/demand/demand_quiz.html';
        return;
    }
    
    // Default message for quizzes not yet built
    const urlSafeName = chapterName.replace(/[^\w\s]/g, '').replace(/\s+/g, '-').toLowerCase();
    alert(`Quiz not yet implemented for: ${chapterName}! (Payment Confirmed) Target URL: /quizzes/${urlSafeName}.html`);
}

/**
 * 1. Calls the Supabase Edge Function to create an Order ID.
 * 2. Initiates the Razorpay payment process.
 * 3. Calls redirectAfterPayment() on success.
 * @param {string} cleanedChapterName - The name of the chapter/quiz being attempted.
 */
async function initiateRazorpayPayment(cleanedChapterName) {
    try {
        await loadRazorpayScript();

        // 1. CALL EDGE FUNCTION TO CREATE ORDER
        // Send details needed for the order (e.g., amount, chapter)
        const response = await fetch(API_URL_CREATE_ORDER, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                chapter_name: cleanedChapterName,
                // The price logic should ideally be handled securely on the server
                // but you can pass an identifier like 'quiz_access'
                item_id: 'quiz_access_micro_econ', 
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to create Razorpay Order.');
        }

        const orderData = await response.json();
        const { order_id, amount, currency, user_id } = orderData; 

        // 2. DEFINE SUCCESS HANDLER
        const successHandler = (response) => {
            console.log('Payment Successful:', response.razorpay_payment_id);
            
            // Redirect the user. The actual "unlocking" of the quiz 
            // is confirmed by your Supabase Webhook handler on the server.
            redirectAfterPayment(cleanedChapterName);
        };

        // 3. DEFINE OPTIONS AND OPEN CHECKOUT
        const options = {
            key: RAZORPAY_KEY_ID, 
            amount: amount, // Amount from the server
            currency: currency, // Currency from the server
            order_id: order_id, // Order ID from the server
            name: 'Ready4Exam Quiz Access',
            description: `Access to Quiz: ${cleanedChapterName}`,
            handler: successHandler, 
            prefill: {
                // You would typically get the logged-in user's details here
                name: '', 
                email: '', 
                contact: ''
            },
            notes: {
                chapter_name: cleanedChapterName,
                user_id: user_id // Pass the logged-in user ID
            },
            modal: {
                ondismiss: () => {
                    console.log('Payment window closed by user.');
                }
            }
        };

        const rzp = new Razorpay(options);
        rzp.open();

    } catch (error) {
        console.error('Payment initiation error:', error);
        alert('Could not start payment. Please ensure you are logged in and try again.');
    }
}

// Main function to be called from the HTML onclick events
function handleChapterClick(cleanedChapterName) {
    console.log(`Attempting to access quiz for: ${cleanedChapterName}`);
    initiateRazorpayPayment(cleanedChapterName);
}
