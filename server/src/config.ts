// Configuration file for API keys and settings
export default {
  port: process.env.PORT || 3000,
  groqApiKey: process.env.GROQ_API_KEY || 'your_groq_api_key_here', // Replace with your actual API key in a .env file
  transcriptionModel: 'whisper-large-v3'
}; 