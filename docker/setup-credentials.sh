#!/bin/bash
# Synq Docker Setup Helper
# Run this once before `docker compose up` to configure credentials.

set -e

echo "Setting up Synq Docker environment..."

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "Enter your Anthropic API key (or press Enter to skip):"
    read -r key
    if [ -n "$key" ]; then
        echo "ANTHROPIC_API_KEY=$key" >> .env
        echo "API key saved to .env"
    else
        echo "Skipped — you can add ANTHROPIC_API_KEY to .env later."
    fi
else
    echo "ANTHROPIC_API_KEY already set in environment."
fi

echo "Setup complete! Run: docker compose up"
