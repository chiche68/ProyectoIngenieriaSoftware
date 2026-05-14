require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 3000;

console.log('Iniciando servidor...');
console.log('Puerto:', PORT);
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`✅ Puerto: ${PORT}`);
  console.log(`✅ Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅ Hora de inicio: ${new Date().toISOString()}`);
});
