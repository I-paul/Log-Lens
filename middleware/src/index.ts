import dotenv from 'dotenv';
import app from './app';

dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

app.listen(PORT, () => {
  console.log(`Middleware server running on port ${PORT}`);
});
