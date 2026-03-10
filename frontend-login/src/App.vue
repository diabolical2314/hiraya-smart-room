<script setup>
import { ref } from 'vue'
import Dashboard from './components/Dashboard.vue' // 1. Import the new component

const email = ref('')
const password = ref('')
const message = ref('')
const isError = ref(false)
const isLoginMode = ref(true)

// 2. Add a variable to track login status
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
        // 3. IF LOGIN IS SUCCESSFUL, change the state to true!
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

  <main class="login-container" v-else>
    <form @submit.prevent="handleSubmit" class="login-form">
      <h2>{{ isLoginMode ? 'System Login' : 'Register New User' }}</h2>
      
      <div class="input-group">
        <label for="email">Email (@gmail.com only)</label>
        <input v-model="email" type="email" id="email" required />
      </div>

      <div class="input-group">
        <label for="password">Password (min 6 chars)</label>
        <input v-model="password" type="password" id="password" required />
      </div>

      <button type="submit">{{ isLoginMode ? 'Log In' : 'Register' }}</button>

      <p class="toggle-text">
        {{ isLoginMode ? "Don't have an account?" : "Already have an account?" }}
        <a href="#" @click.prevent="isLoginMode = !isLoginMode; message = ''">
          {{ isLoginMode ? 'Register here' : 'Log in here' }}
        </a>
      </p>

      <p v-if="message" :class="{ 'error-text': isError, 'success-text': !isError }">
        {{ message }}
      </p>
    </form>
  </main>
</template>

<style scoped>
/* Leave your exact login CSS here, unchanged from before */
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  font-family: Arial, sans-serif;
}
.login-form {
  display: flex;
  flex-direction: column;
  width: 320px;
  padding: 2rem;
  border: 1px solid #ccc;
  border-radius: 8px;
  background: #f9f9f9;
}
.input-group {
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
}
input {
  padding: 0.5rem;
  margin-top: 0.25rem;
}
button {
  padding: 0.75rem;
  background-color: #42b883;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  margin-top: 1rem;
}
.toggle-text {
  margin-top: 1rem;
  font-size: 0.85rem;
  text-align: center;
}
.error-text { color: red; margin-top: 1rem; font-size: 0.9rem; text-align: center;}
.success-text { color: green; margin-top: 1rem; font-size: 0.9rem; text-align: center;}
</style>