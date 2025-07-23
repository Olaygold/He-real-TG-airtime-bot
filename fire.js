// fire.js
const firebase = require("firebase-admin");
require("firebase/database"); // For Realtime Database

const firebaseConfig = {
  apiKey: "AIzaSyDSpnEAsAGQou1Jl2Guy4nlrmtwcnSPoBw",
  authDomain: "ride-35267.firebaseapp.com",
  databaseURL: "https://ride-35267-default-rtdb.firebaseio.com",
  projectId: "ride-35267",
  storageBucket: "ride-35267.appspot.com",
  messagingSenderId: "736784284446",
  appId: "1:736784284446:web:8539c5a00e8adc3467670f"
};

// Initialize Firebase if it hasn't been initialized
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const database = firebase.database();

module.exports = {
  firebase,
  database
};
