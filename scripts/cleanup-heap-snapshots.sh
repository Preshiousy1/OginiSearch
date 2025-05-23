#!/bin/bash

# Heap Snapshot Cleanup Script
# Automatically removes old heap snapshot and profiling files to save disk space

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🧹 Heap Snapshot Cleanup Starting..."

# Function to clean up files older than specified days
cleanup_old_files() {
    local pattern="$1"
    local days="$2"
    local description="$3"
    
    echo "   Cleaning $description older than $days days..."
    
    if find . -name "$pattern" -type f -mtime +$days -print0 2>/dev/null | xargs -0 rm -f 2>/dev/null; then
        local count=$(find . -name "$pattern" -type f -mtime +$days 2>/dev/null | wc -l | tr -d ' ')
        if [ "$count" -gt 0 ]; then
            echo "   ✅ Removed $count old $description files"
        fi
    fi
}

# Function to clean up large files immediately
cleanup_large_files() {
    local pattern="$1"
    local size="$2"
    local description="$3"
    
    echo "   Cleaning large $description (>$size)..."
    
    if find . -name "$pattern" -type f -size +$size -print0 2>/dev/null | xargs -0 rm -f 2>/dev/null; then
        local count=$(find . -name "$pattern" -type f -size +$size 2>/dev/null | wc -l | tr -d ' ')
        if [ "$count" -gt 0 ]; then
            echo "   ✅ Removed $count large $description files"
        fi
    fi
}

# Remove heap snapshot files
echo "📊 Cleaning heap snapshots..."
cleanup_old_files "*.heapsnapshot" 1 "heap snapshots"
cleanup_large_files "*.heapsnapshot" "10M" "heap snapshots"

# Remove CPU profile files
echo "🔍 Cleaning CPU profiles..."
cleanup_old_files "*.cpuprofile" 1 "CPU profiles"
cleanup_large_files "*.cpuprofile" "5M" "CPU profiles"

# Clean up profiles directory if it exists and is old
if [ -d "profiles" ]; then
    echo "📁 Cleaning profiles directory..."
    
    # Remove old files in profiles directory
    find profiles/ -name "*.heapsnapshot" -type f -mtime +1 -delete 2>/dev/null || true
    find profiles/ -name "*.cpuprofile" -type f -mtime +1 -delete 2>/dev/null || true
    
    # Remove large files immediately
    find profiles/ -name "*" -type f -size +10M -delete 2>/dev/null || true
    
    # Remove empty profiles directory
    if [ -z "$(ls -A profiles/ 2>/dev/null)" ]; then
        rmdir profiles/ 2>/dev/null || true
        echo "   ✅ Removed empty profiles directory"
    else
        local count=$(find profiles/ -type f 2>/dev/null | wc -l | tr -d ' ')
        echo "   📁 Profiles directory kept ($count files remaining)"
    fi
fi

# Clean up any other profiling artifacts
echo "🗑️  Cleaning other profiling artifacts..."
cleanup_old_files "isolate-*-v8.log" 1 "V8 logs"
cleanup_old_files "*.trace" 3 "trace files"
cleanup_old_files "core.*" 1 "core dumps"

# Show disk space saved
echo ""
echo "💾 Cleanup Summary:"
echo "   - Heap snapshots older than 1 day: removed"
echo "   - CPU profiles older than 1 day: removed"
echo "   - Files larger than 10MB: removed immediately"
echo "   - V8 logs older than 1 day: removed"
echo "   - Trace files older than 3 days: removed"
echo "   - Core dumps older than 1 day: removed"

echo ""
echo "✅ Heap snapshot cleanup completed!"
echo "💡 Tip: Run this script regularly or add it to a cron job" 