#!/bin/bash
# Test script - replace with your own token
TOKEN="YOUR_GITHUB_TOKEN"
curl -s -w "\n%{http_code}" -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"test write\",\"content\":\"dGVzdA==\"}" \
  "https://api.github.com/repos/dxinschool/LyRPC/contents/test_write.txt"
