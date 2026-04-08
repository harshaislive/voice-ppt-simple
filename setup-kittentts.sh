#!/bin/bash
# Setup KittenTTS for Voice-PPT
# This script installs KittenTTS and starts a TTS server on port 8080.
# Requires sudo for system dependencies.

set -e

echo "=== Setting up KittenTTS ==="

# Check if sudo is available
if ! command -v sudo &> /dev/null; then
    echo "Error: sudo is required to install system dependencies."
    echo "Please run this script on a system with sudo privileges."
    exit 1
fi

# Install system dependencies
echo "Installing system dependencies (espeak-ng)..."
sudo apt-get update
sudo apt-get install -y espeak-ng python3.11-venv python3.11-dev

# Create virtual environment
VENV_DIR="$(dirname "$0")/.venv-tts"
echo "Creating virtual environment at $VENV_DIR..."
python3.11 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

# Install KittenTTS and dependencies
echo "Installing KittenTTS..."
pip install --upgrade pip
pip install https://github.com/KittenML/KittenTTS/releases/download/0.8.1/kittentts-0.8.1-py3-none-any.whl

# Test installation
echo "Testing KittenTTS..."
python -c "from kittentts import KittenTTS; model = KittenTTS('KittenML/kitten-tts-mini-0.8'); print('KittenTTS loaded successfully')"

# Create a simple HTTP server script that matches Voice-PPT API
cat > "$VENV_DIR/kittentts_server.py" << 'EOF'
import json
import soundfile as sf
import io
from http.server import HTTPServer, BaseHTTPRequestHandler
from kittentts import KittenTTS

print("Loading KittenTTS model...")
model = KittenTTS("KittenML/kitten-tts-mini-0.8")
print("Model loaded.")

# Map voice names to KittenTTS voices
VOICE_MAP = {
    'default': 'expr-voice-2-f',
    'female': 'expr-voice-2-f',
    'male': 'expr-voice-2-m',
    'expr-voice-2-f': 'expr-voice-2-f',
    'expr-voice-2-m': 'expr-voice-2-m',
    'expr-voice-3-f': 'expr-voice-3-f',
    'expr-voice-3-m': 'expr-voice-3-m',
    'expr-voice-4-f': 'expr-voice-4-f',
    'expr-voice-4-m': 'expr-voice-4-m',
    'expr-voice-5-f': 'expr-voice-5-f',
    'expr-voice-5-m': 'expr-voice-5-m',
}

class TTSHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/tts':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            text = data.get('text', '')
            voice_req = data.get('voice', 'default')
            speed = data.get('speed', 1.0)
            # format ignored, always WAV
            
            if not text:
                self.send_error(400, "Missing 'text' field")
                return
            
            # Map voice
            voice = VOICE_MAP.get(voice_req, 'expr-voice-2-f')
            
            try:
                # Generate audio
                audio = model.generate(text, voice=voice, speed=speed)
                
                # Convert to WAV in memory
                buffer = io.BytesIO()
                sf.write(buffer, audio, 24000, format='WAV')
                buffer.seek(0)
                
                # Send response
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(buffer.getbuffer().nbytes))
                self.end_headers()
                self.wfile.write(buffer.read())
                
            except Exception as e:
                self.send_error(500, f"TTS generation failed: {str(e)}")
        else:
            self.send_error(404, "Not found")
    
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        elif self.path == '/voices':
            voices = list(VOICE_MAP.keys())
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = json.dumps({'voices': voices})
            self.wfile.write(response.encode())
        else:
            self.send_error(404, "Not found")
    
    def log_message(self, format, *args):
        # Suppress default logging
        pass

if __name__ == '__main__':
    server = HTTPServer(('localhost', 8080), TTSHandler)
    print("KittenTTS server running on http://localhost:8080/tts")
    print("Endpoints:")
    print("  POST /tts  - synthesize speech")
    print("  GET /health - health check")
    print("  GET /voices - list available voices")
    server.serve_forever()
EOF

echo "KittenTTS setup complete!"
echo ""
echo "To start the TTS server, run:"
echo "  source $VENV_DIR/bin/activate"
echo "  python $VENV_DIR/kittentts_server.py"
echo ""
echo "The server will be available at http://localhost:8080/tts"
echo ""
echo "Update your .env file:"
echo "  KITTENTTS_URL=http://localhost:8080/tts"
EOF