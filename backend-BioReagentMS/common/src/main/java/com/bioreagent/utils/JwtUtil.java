package com.bioreagent.utils;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

import javax.crypto.SecretKey;
import java.util.Base64;
import java.util.Date;
import java.util.Map;

public class JwtUtil {

    /**
     * 生成 JWT（HS256）
     */
    public static String createJWT(String secretKey, long ttlMillis, Map<String, Object> claims) {
        SecretKey key = Keys.hmacShaKeyFor(Base64.getDecoder().decode(secretKey));
        long expMillis = System.currentTimeMillis() + ttlMillis;
        return Jwts.builder()
                .claims(claims)
                .signWith(key)
                .expiration(new Date(expMillis))
                .compact();
    }

    /**
     * 解析并校验 JWT，返回 claims
     */
    public static Claims parseJWT(String secretKey, String token) {
        SecretKey key = Keys.hmacShaKeyFor(Base64.getDecoder().decode(secretKey));
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
