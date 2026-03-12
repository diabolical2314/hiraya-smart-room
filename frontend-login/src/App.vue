<script setup>
import { ref } from 'vue'
import Dashboard from './components/Dashboard.vue'

const email = ref('')
const password = ref('')
const message = ref('')
const isError = ref(false)
const isLoginMode = ref(true)
const isLoggedIn = ref(false)

const handleSubmit = async () => {
  message.value = 'Processing...'
  isError.value = false

  const endpoint = isLoginMode.value ? 'login' : 'register'

  try {
    const response = await fetch(`http://localhost:3000/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.value,
        password: password.value
      })
    })

    const data = await response.json()

    if (!response.ok) {
      isError.value = true
      message.value = Array.isArray(data.message) ? data.message[0] : data.message
    } else {
      if (isLoginMode.value) {
        isLoggedIn.value = true
      } else {
        message.value = 'Registration successful! You can now log in.'
        isLoginMode.value = true
        password.value = ''
      }
    }
  } catch (err) {
    isError.value = true
    message.value = 'Failed to connect to the server.'
  }
}
</script>

<template>
  <Dashboard v-if="isLoggedIn" />

  <div class="page-wrapper" v-else>
    <div class="login-container">

      <!-- LOGO -->
      <div class="logo-container">
        <img 
          src="@/assets/csulogo no bg.png"
          alt="CSU Logo"
          class="csu-logo"
        />

        <h1 class="hero-title">Hiraya</h1>
        <h1 class="hero-title">Smart-Room</h1>
      </div>

      <!-- Notice -->
      <div class="notice">
        {{ isLoginMode ? "New to the website?" : "Already registered?" }}

        <span @click="isLoginMode = !isLoginMode; message = ''">
          <u v-if="isLoginMode">Click here</u>
          <span v-else>Login instead.</span>
        </span>
      </div>

      <!-- LOGIN CARD -->
      <div class="login-card">

        <input
          class="custom-input"
          type="email"
          placeholder="Email"
          v-model="email"
        />

        <input
          class="custom-input"
          type="password"
          placeholder="Password"
          v-model="password"
        />

        <button class="btn-login" @click="handleSubmit">
          {{ isLoginMode ? "Log in" : "Register" }}
        </button>

        <p v-if="message" :class="{ 'error-text': isError, 'success-text': !isError }">
          {{ message }}
        </p>

      </div>

    </div>
  </div>
</template>

<style >

/* BACKGROUND */

body {
  margin: 0px;
}

.page-wrapper {
  min-height: 100vh;

  background-image: url("@/assets/greenpoto.jpg");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;

  display: flex;
  justify-content: center;
  align-items: center;

  padding: 20px;
}

/* CONTAINER */

.login-container {
  width: 420px;
}

/* NOTICE */

.notice {
  background-color: #E0E0E0;
  padding: 12px;
  margin-bottom: 25px;
  border-radius: 6px;
  font-size: 14px;
  text-align: center;
  color: #212121;
}

.notice span:hover{
  color: #1B5E20;
  cursor: pointer;
  font-weight: bold;
}

/* CARD */

.login-card {
  background-color: #F2F2F2;
  padding: 28px;
  border-radius: 10px;
  border-bottom: 4px solid #FBC02D;
  box-shadow: 0 8px 20px rgba(0,0,0,0.2);

  display: flex;
  flex-direction: column;
  align-items: center;
}

/* LOGO */

.logo-container {
  text-align: center;
  margin-bottom: 40px;
  color: #FFFFFF;
}

.csu-logo {
  width: 110px;
  height: auto;
  margin-bottom: 15px;
}

.hero-title {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: 70px;
  margin: 0;
  letter-spacing: 0.5px;
}

/* INPUT */

.custom-input {
  width: 90%;
  padding: 10px;
  margin-bottom: 14px;
  border: 1px solid #D6D6D6;
  border-radius: 6px;
  background-color: #FFFFFF;
  font-size: 13px;
}

.custom-input:focus {
  outline: none;
  border-color: #2E7D32;
}

/* BUTTON */

.btn-login {
  width: 150px;
  background-color: #66BB6A;
  color: #FFFFFF;
  border: none;
  padding: 8px 14px;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  display: block;
  margin: 0 auto;
}

.btn-login:hover {
  background-color: #2E7D32;
}

/* MESSAGE */

.error-text {
  color: red;
  margin-top: 15px;
  text-align: center;
}

.success-text {
  color: green;
  margin-top: 15px;
  text-align: center;
}


/* =========================
   MOBILE RESPONSIVE
========================= */

@media (max-width: 600px) {

  .login-container {
    width: 95%;
  }

  .hero-title {
    font-size: 40px;
  }

  .csu-logo {
    width: 80px;
  }

  .login-card {
    padding: 20px;
  }

  .custom-input {
    width: 100%;
  }

  .btn-login {
    width: 100%;
  }

  .notice {
    font-size: 13px;
    padding: 10px;
  }

}

</style>