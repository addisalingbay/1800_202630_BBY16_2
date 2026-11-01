// src/authentication.js
// ------------------------------------------------------------
// Part of the COMP1800 Projects 1 Course (BCIT).
// Starter code provided for students to use and adapt.
// Contains reusable Firebase Authentication functions
// (login, signup, logout, and auth state checks).
// -------------------------------------------------------------

// Import the initialized Firebase Authentication object
import { auth } from "../js/firebaseConfig.js";
import { db } from "../js/firebaseConfig.js";
import { doc, setDoc } from "firebase/firestore";

// Import specific functions from the Firebase Auth SDK
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";

// -------------------------------------------------------------
// loginUser(email, password)
// -------------------------------------------------------------
// Logs an existing user into Firebase Authentication.
//
// Parameters:
//   email (string)    - user's email
//   password (string) - user's password
//
// Returns: Promise resolving to the user credential object.
// Usage:
//   await loginUser("user@example.com", "password123");
// -------------------------------------------------------------
export async function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

// -------------------------------------------------------------
// signupUser(name, email, password)
// -------------------------------------------------------------
// Creates a new user account with Firebase Authentication,
// then updates the user's profile with a display name.
//
// Parameters:
//   name (string)     - user's display name
//   email (string)    - user's email
//   password (string) - user's password
//
// Returns: the created user object.
// Usage:
//   const user = await signupUser("Alice", "alice@email.com", "secret");
// -------------------------------------------------------------
export async function signupUser(name, email, password) {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user; // Get the user object

  // Update the user's profile with the display name, NOTE: updateProfile is a built-in Firebase function
  await updateProfile(user, { displayName: name });

  // After creating the user, we can also create a Firestore document for them with default values for country and school.
  // This demonstrates how to link Auth users to Firestore data.
  // Use 'try' 'catch' to handle any errors that might occur during Firestore document creation.
  try {
    // Create a Firestore document for the new user with default values
    await setDoc(doc(db, "users", user.uid), {
      name: name,
      email: email,
      country: "Canada", // Default value
      school: "BCIT"     // Default value
    });
    console.log("Firestore user document created successfully!");
} catch (error) {
  // Information for debugging: show the error code  
  // In a real app, you might want to show a user-friendly message instead of the raw error.
  // console.error("Error creating user document in Firestore:", error);
  // console output may not be seen if redirection to main.html happens
  // Therefore, we can try "alert".  
  alert(`Error creating user document:\n${error.code || ""}\n${error.message || error}`);
}
  // Return the user object for further use (e.g., redirecting or showing a welcome message)
  return user;
}

// -------------------------------------------------------------
// logoutUser()
// -------------------------------------------------------------
// Signs out the currently logged-in user and redirects them
// back to the login page (index.html).
//
// Usage:
//   await logoutUser();
// -------------------------------------------------------------
export async function logoutUser() {
  await signOut(auth);
  window.location.href = "loginSignup.html";
}

// -------------------------------------------------------------
// checkAuthState()
// -------------------------------------------------------------
// Observes changes in the user's authentication state (login/logout)
// and updates the UI or redirects accordingly.
//
// If the user is on "main.html":
//   - If logged in → displays "Hello, [Name]!"
//   - If not logged in → redirects to "index.html"
//
// This function should be called once when the page loads.
//
// Usage:
//   checkAuthState();
// -------------------------------------------------------------
export function checkAuthState() {
  onAuthStateChanged(auth, (user) => {
    if (window.location.pathname.endsWith("homePage.html")) {
      if (user) {
        const displayName = user.displayName || user.email;
        $("#welcomeMessage").text(`Hello, ${displayName}!`);
      } else {
        window.location.href = "loginSignup.html";
      }
    }
  });
}

// -------------------------------------------------------------
// onAuthReady(callback)
// -------------------------------------------------------------
// Wrapper for Firebase's onAuthStateChanged()
// Runs the given callback(user) when Firebase resolves or changes auth state.
// Useful for showing user info or redirecting after login/logout.
export function onAuthReady(callback) {
  return onAuthStateChanged(auth, callback);
}

// -------------------------------------------------------------
// authErrorMessage(error)
// -------------------------------------------------------------
// Maps Firebase Auth error codes to short, user-friendly messages.
// Helps display clean error alerts instead of raw Firebase codes.
export function authErrorMessage(error) {
  const code = (error?.code || "").toLowerCase();

  const map = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
    "auth/email-already-in-use": "Email is already in use.",
    "auth/weak-password": "Password too weak (min 6 characters).",
    "auth/missing-password": "Password cannot be empty.",
    "auth/network-request-failed": "Network error. Try again.",
  };

  return map[code] || "Something went wrong. Please try again.";
}

