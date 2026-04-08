#!/bin/bash

echo "=== Voice-PPT Project Verification ==="
echo ""

# Check if required files exist
echo "1. Checking project structure..."
required_files=(
    "package.json"
    "server.js"
    ".env"
    ".env.example"
    "public/index.html"
    "public/styles.css"
    "public/app.js"
    "public/audio-player.js"
    "public/socket-client.js"
    "server/db/init.js"
    "server/db/migrations.sql"
    "server/decks/beforest_pitch.json"
    "server/routes/session.js"
    "server/routes/questions.js"
    "server/routes/narration.js"
    "server/routes/slides.js"
    "server/services/model.js"
    "server/services/tts.js"
    "server/services/retrieval.js"
    "server/services/slideEngine.js"
    "server/services/questionClassifier.js"
    "server/services/stateStore.js"
    "server/services/dbHelper.js"
    "server/prompts/narrationPrompt.js"
    "server/prompts/classifyQuestionsPrompt.js"
    "server/prompts/nextStepPrompt.js"
)

missing_files=()
for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        missing_files+=("$file")
    fi
done

if [ ${#missing_files[@]} -eq 0 ]; then
    echo "   ✓ All required files present"
else
    echo "   ✗ Missing files: ${missing_files[*]}"
    exit 1
fi

# Check database
echo "2. Checking database..."
if [ -f "voice-ppt.db" ]; then
    echo "   ✓ Database file exists"
else
    echo "   ✗ Database file not found"
    exit 1
fi

# Check node modules
echo "3. Checking dependencies..."
if [ -d "node_modules" ]; then
    echo "   ✓ Node modules installed"
else
    echo "   ✗ Node modules not installed. Run: npm install"
    exit 1
fi

# Test server startup
echo "4. Testing server startup..."
timeout 5 npm start > /tmp/server_test.log 2>&1 &
SERVER_PID=$!
sleep 2

if ps -p $SERVER_PID > /dev/null; then
    echo "   ✓ Server started successfully"
    kill $SERVER_PID 2>/dev/null || true
else
    echo "   ✗ Server failed to start"
    cat /tmp/server_test.log
    exit 1
fi

echo ""
echo "=== Verification Complete ==="
echo "All checks passed! The project is ready to run."
echo ""
echo "To start the server:"
echo "  npm start"
echo ""
echo "Then open http://localhost:3000 in your browser."
