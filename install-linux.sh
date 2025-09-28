#!/bin/bash

# Digital Signage Installation Script for Linux
# This script sets up persistent storage and ensures proper permissions

set -e

echo "🎬 Digital Signage Installation for Linux"
echo "=========================================="

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo "⚠️  Warning: Running as root. Consider creating a dedicated user for the signage application."
fi

# Default data directory
DEFAULT_DATA_DIR="/var/lib/signage"
DATA_DIR="${SIGNAGE_DATA_DIR:-$DEFAULT_DATA_DIR}"

echo "📂 Data directory: $DATA_DIR"

# Create data directory
echo "Creating data directory..."
sudo mkdir -p "$DATA_DIR"
sudo mkdir -p "$DATA_DIR/uploads"

# Set proper permissions
echo "Setting permissions..."
if command -v systemctl >/dev/null 2>&1; then
    # If systemd is available, assume we're setting up for a service
    sudo chown -R www-data:www-data "$DATA_DIR" 2>/dev/null || {
        # Fallback if www-data doesn't exist
        sudo chown -R $(whoami):$(whoami) "$DATA_DIR"
        echo "⚠️  Set ownership to current user. You may need to adjust this for your web server."
    }
else
    # No systemd, just use current user
    sudo chown -R $(whoami):$(whoami) "$DATA_DIR"
fi

sudo chmod -R 755 "$DATA_DIR"
sudo chmod -R 644 "$DATA_DIR"/*.json 2>/dev/null || true

echo "✅ Directory setup complete!"

# Create environment file template
ENV_FILE=".env.local"
if [ ! -f "$ENV_FILE" ]; then
    echo "📝 Creating environment configuration..."
    cat > "$ENV_FILE" << EOF
# Digital Signage Configuration
SIGNAGE_DATA_DIR=$DATA_DIR
ADMIN_PASSWORD=aiarkp@123

# Optional: Database URL for production
# DATABASE_URL=file:$DATA_DIR/signage.db

# Optional: Custom port
# PORT=3000
EOF
    echo "✅ Created $ENV_FILE with default configuration"
else
    echo "ℹ️  Environment file $ENV_FILE already exists"
fi

# Create systemd service file template
SERVICE_FILE="signage.service"
if [ ! -f "$SERVICE_FILE" ]; then
    echo "📝 Creating systemd service template..."
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Digital Signage Player
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=$(pwd)
Environment=NODE_ENV=production
Environment=SIGNAGE_DATA_DIR=$DATA_DIR
EnvironmentFile=$(pwd)/.env.local
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
    echo "✅ Created $SERVICE_FILE template"
    echo "📋 To install as a system service:"
    echo "   sudo cp $SERVICE_FILE /etc/systemd/system/"
    echo "   sudo systemctl enable signage"
    echo "   sudo systemctl start signage"
else
    echo "ℹ️  Service file $SERVICE_FILE already exists"
fi

# Display post-installation instructions
echo ""
echo "🎉 Installation Complete!"
echo "========================"
echo ""
echo "📁 Data directory: $DATA_DIR"
echo "📄 Environment file: $(pwd)/$ENV_FILE"
echo "🔧 Service template: $(pwd)/$SERVICE_FILE"
echo ""
echo "🚀 Next steps:"
echo "1. Install dependencies: npm install"
echo "2. Build the application: npm run build"
echo "3. Start the server: npm start"
echo "4. Access admin portal: http://localhost:3000/admin"
echo "5. Default admin password: aiarkp@123"
echo ""
echo "📋 For production deployment:"
echo "• Copy and customize the systemd service file"
echo "• Configure a reverse proxy (nginx/apache)"
echo "• Set up SSL certificates"
echo "• Configure firewall rules"
echo ""
echo "💾 All your files, schedules, and settings will be"
echo "   automatically saved to $DATA_DIR and restored on restart!"
echo ""
EOF