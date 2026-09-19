package com.bioreagent.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.connection.RedisPassword;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;

import java.time.Duration;

@Configuration
public class RedisConfig {

    @Bean
    public LettuceConnectionFactory redisConnectionFactory(Environment env) {
        RedisStandaloneConfiguration config = new RedisStandaloneConfiguration();
        config.setHostName(env.getProperty("spring.redis.host", "localhost"));
        config.setPort(Integer.parseInt(env.getProperty("spring.redis.port", "6379")));
        String password = env.getProperty("spring.redis.password");
        if (password != null && !password.isEmpty()) {
            config.setPassword(RedisPassword.of(password));
        }
        String database = env.getProperty("spring.redis.database");
        if (database != null) {
            config.setDatabase(Integer.parseInt(database));
        }
        return new LettuceConnectionFactory(config);
    }

    @Bean
    public RedisCacheConfiguration redisCacheConfiguration() {
        return RedisCacheConfiguration.defaultCacheConfig()
                // 1. 用 JSON 存值（不用 JDK 二进制）
                .serializeValuesWith(
                        RedisSerializationContext.SerializationPair
                                .fromSerializer(new GenericJackson2JsonRedisSerializer())
                )
                // 2. 缓存默认 30 分钟过期（可删，不设就永不过期）
                .entryTtl(Duration.ofMinutes(30));
    }
}
