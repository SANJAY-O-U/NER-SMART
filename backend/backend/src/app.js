const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const shipmentRoutes = require('./routes/shipmentRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const roadRoutes = require('./routes/roadRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const alertRoutes = require('./routes/alertRoutes');
const riskRoutes = require('./routes/riskRoutes');
const routeRoutes = require('./routes/routeRoutes');
const simulationRoutes = require('./routes/simulationRoutes');
const demoRoutes = require('./routes/demoRoutes');
const dataSourceRoutes = require('./routes/dataSourceRoutes');
const weatherRoutes = require('./routes/weatherRoutes');
const sachetRoutes = require('./routes/sachetRoutes');

const { errorHandler, notFound } = require('./utils/errorHandler');

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'ner-smart-backend',
      appMode: process.env.APP_MODE || 'demo',
    },
  });
});

app.use('/api/shipments', shipmentRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/roads', roadRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/risk', riskRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/simulation', simulationRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/datasources', dataSourceRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/sachet', sachetRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
