// ======================================================================
// JS/quiz_navigation.js - COMPLETE SECURE WORKFLOW IMPLEMENTATION
// This file handles Authentication (Firebase), Identity Sync (Supabase Edge), 
// Payment Initiation (Razorpay/Supabase Edge), and Access Checking (Firestore).
// ======================================================================

// --- CONFIGURATION: REPLACE THESE PLACEHOLDERS ---
const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
    projectId: "YOUR_FIREBASE_PROJECT_ID",
    // Add other Firebase config fields if necessary (databaseURL, storageBucket, etc.)
};

const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const RAZORPAY_KEY_ID = 'YOUR_RAZORPAY_KEY_ID'; // Public ID, starts with 'rzp_live' or 'rzp_test'
const PAYMENT_AMOUNT_PAISE = 50000; // e.g., ₹500.00 = 50000 paise (CRITICAL: Must match server)
const API_URL_CREATE_ORDER = '/functions/v1/create-order'; 
const API_URL_SYNC_USER = '/functions/v1/sync-user'; 

// --- INITIALIZATION ---

// Firebase Init (Uses the script tags loaded in HTML)
const app = firebase.initializeApp(firebaseConfig);
const auth = app.auth();
const db = app.firestore(); // Firestore instance for reading the 'hasPaid' flag

// Supabase Init (Uses the script tag loaded in HTML)
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// ======================================================================
// 1. Core Logic: startQuiz (The Secure Access Gate)
// This function determines if a user is logged in, paid, or needs to pay.
// This should be the function called by the 'Start Quiz' button click handlers.
// ======================================================================

async function startQuiz(chapterName) {
    const user = auth.currentUser;
    const cleanedChapterName = chapterName.trim();
    // Assuming "Master Quiz" is the premium content. Adjust logic if needed.
    const isPremiumQuiz = (cleanedChapterName === "Master Quiz"); 

    if (!user) {
        showAuthModal(); // User not logged in, trigger Firebase Auth
        return;
    }
    
    // --- STANDARD QUIZ LOGIC (Free Content) ---
    if (!isPremiumQuiz) {
        logQuizAttempt(user.uid, cleanedChapterName, "Access Granted (Free)");
        navigateToQuiz(cleanedChapterName);
        return;
    }

    // --- PREMIUM QUIZ LOGIC ("Master Quiz") ---
    
    try {
        // Step 8: Check Firestore for the 'hasPaid' flag (Fast Client Cache)
        const userDocRef = db.collection('users').doc(user.uid);
        const userDoc = await userDocRef.get();

        if (userDoc.exists && userDoc.data().hasPaid === true) {
            // Access Granted
            logQuizAttempt(user.uid, cleanedChapterName, "Access Granted (Paid)");
            alert("Payment confirmed. Starting Master Quiz!");
            navigateToQuiz(cleanedChapterName);
            return;
        }

        // Access denied, initiate payment
        alert("This is a premium quiz. Initiating secure payment...");
        
        // Step 3: Call the secure 'create-order' Edge Function
        const token = await user.getIdToken(); // Get the Firebase JWT
        
        const response = await fetch(SUPABASE_URL + API_URL_CREATE_ORDER, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                // Pass the Supabase JWT for the Edge Function to authenticate the user
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ amount: PAYMENT_AMOUNT_PAISE, currency: 'INR' })
        });

        if (!response.ok) {
            console.error('Error creating Razorpay order:', await response.text());
            alert("Could not initiate payment. Please check console.");
            return;
        }

        const orderData = await response.json();

        // Step 4: Open Razorpay Modal 
        launchRazorpayModal(orderData.orderId, user.email, user.uid, cleanedChapterName);

    } catch (error) {
        console.error("Error during Premium Quiz check/payment:", error);
        alert("An error occurred during quiz access check.");
    }
}


// ======================================================================
// 2. Payment Modal Handling (Step 4)
// ======================================================================

function launchRazorpayModal(order_id, userEmail, firebaseUid, quizName) {
    const options = {
        "key": RAZORPAY_KEY_ID, 
        "amount": PAYMENT_AMOUNT_PAISE,
        "currency": "INR",
        "name": "CBSE Economics Portal",
        "description": `Access for ${quizName}`,
        "order_id": order_id, 
        "handler": function (response) {
            // Success handler: The webhook handles the access grant.
            alert("Payment initiated successfully! Access is being granted by our secure server. Please wait for the quiz to load...");
            
            // Start listening to Firestore for the final 'hasPaid' update (Instantaneous Access)
            listenForPaymentConfirmation(firebaseUid, quizName);
            logQuizAttempt(firebaseUid, quizName, `Payment Success: ${response.razorpay_payment_id}`);
        },
        "prefill": {
            "email": userEmail,
        },
        "theme": {
            "color": "#1a3e6a" 
        },
        "modal": {
            "ondismiss": function() {
                alert("Payment window closed. Please complete the payment to access the quiz.");
            }
        }
    };

    const rzp = new Razorpay(options);
    rzp.open();
}

// ======================================================================
// 3. Post-Payment Access Listener (Step 8: Instantaneous access)
// ======================================================================

function listenForPaymentConfirmation(firebaseUid, quizName) {
    const userDocRef = db.collection('users').doc(firebaseUid);
    let quizStarted = false;

    // Set up a real-time listener for the user's Firestore document
    const unsubscribe = userDocRef.onSnapshot(doc => {
        if (doc.exists && doc.data().hasPaid === true && !quizStarted) {
            quizStarted = true;
            alert("Access granted! Starting the Master Quiz now.");
            unsubscribe(); // Stop listening
            navigateToQuiz(quizName); // Start the quiz!
        }
    }, error => {
        console.error("Error listening for payment confirmation:", error);
        unsubscribe();
    });
}


// ======================================================================
// 4. Identity Sync (Step 2: Profile Sync)
// This links Firebase to Supabase after successful login.
// ======================================================================

async function syncProfile(user) {
    // Get the Firebase JWT to securely pass the user identity to the Edge Function
    const token = await user.getIdToken(); 
    
    // Send the Firebase UID and email to the secure Edge Function
    const response = await fetch(SUPABASE_URL + API_URL_SYNC_USER, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` 
        },
        body: { 
            firebase_uid: user.uid, 
            email: user.email 
        }
    });

    if (!response.ok) {
        console.error('Error syncing user profile:', await response.text());
    } else {
        console.log('User profile synced with Supabase:', await response.json());
    }
}

// ======================================================================
// 5. Placeholder/Utility Functions (Must include your existing logic)
// ======================================================================

// Example placeholder for Google Sign-in listener
const googleSignInBtn = document.getElementById('googleSignInBtn'); 
if (googleSignInBtn) {
    googleSignInBtn.addEventListener('click', async () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            const result = await auth.signInWithPopup(provider);
            hideAuthModal(); 
            await syncProfile(result.user); // CRITICAL: Run sync after successful login (Step 2)
            alert("Login successful and profile synced!");
            // After sync, re-run access check if they were trying to access a paid quiz
            if (sessionStorage.getItem('pendingQuiz')) {
                startQuiz(sessionStorage.getItem('pendingQuiz'));
                sessionStorage.removeItem('pendingQuiz');
            }
        } catch (error) {
            console.error("Google Sign-In Error:", error);
            alert("Login failed. Check console for details.");
        }
    });
}

// --- Placeholder for your view control functions ---
function showView(viewId) {
    document.querySelectorAll('.view').forEach(view => {
        view.classList.add('hidden');
    });
    document.getElementById(viewId + '-view').classList.remove('hidden');
}

function showAuthModal() {
    // Your existing logic to show the login modal
    document.getElementById('authModal').classList.remove('hidden');
}

function hideAuthModal() {
     // Your existing logic to hide the login modal
     document.getElementById('authModal').classList.add('hidden');
}

function navigateToQuiz(chapterName) {
    // Your existing logic to redirect the user to the quiz page
    // Example:
    if (chapterName.includes('Master Quiz')) {  
         window.location.href = './quizzes/economics/master_quiz.html';
         return;
    }
    // ... other navigation rules
}

function logQuizAttempt(userId, chapter, action) {
    // Logging function (optional)
    db.collection("quiz_logs").add({
        userId: userId,
        chapter: chapter,
        action: action,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.error("Error logging attempt:", err));
}


// --- Your existing logic for showing units/attaching listeners must go here ---

function showUnits(book, title, color) {
    // ... [Your existing showUnits logic]
    // You must ensure the 'Start Quiz' button in this logic calls startQuiz(chapterName)
    // and not the placeholder handleChapterClick.
}

function attachEventListeners() {
    // ... [Your existing attachEventListeners logic]
    // Must attach handleQuizButtonClick to quiz buttons
}

function handleQuizButtonClick(event) {
    const chapterName = event.currentTarget.dataset.chapter;
    startQuiz(chapterName); // Call the correct function
}


// --- Initialization on Document Load ---
document.addEventListener('DOMContentLoaded', () => {
    // Attach listeners for dynamic and static elements
    // NOTE: You must include your DOMContentLoaded logic here.
    attachEventListeners(); 
});
