<template>
  <div class="dashboard-wrapper">
    <div class="dashboard">
      <h1>Environmental Monitor</h1>
      
      <div class="cards">
        <div class="card temperature">
          <h2>Temperature</h2>
          <div class="value">28°C</div>
          <p>Current Room Temperature</p>
        </div>

        <div class="card humidity">
          <h2>Humidity</h2>
          <div class="value">65%</div>
          <p>Current Air Humidity</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Scoped means these styles only apply to the dashboard */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: Arial, Helvetica, sans-serif;
}

.dashboard-wrapper {
  background: #f4f7fb;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100vw;
}

.dashboard {
  text-align: center;
}

.dashboard h1 {
  margin-bottom: 40px;
  color: #333;
}

.cards {
  display: flex;
  gap: 30px;
}

.card {
  width: 220px;
  padding: 25px;
  border-radius: 15px;
  color: white;
  box-shadow: 0 10px 20px rgba(0,0,0,0.1);
  transition: 0.3s;
}

.card:hover {
  transform: translateY(-5px);
}

.temperature {
  background: linear-gradient(135deg, #ff7e5f, #ff3e3e);
}

.humidity {
  background: linear-gradient(135deg, #36d1dc, #5b86e5);
}

.card h2 {
  margin-bottom: 15px;
}

.value {
  font-size: 40px;
  font-weight: bold;
  margin-bottom: 10px;
}

.card p {
  font-size: 14px;
  opacity: 0.9;
}
</style>