package com.bioreagent.properties;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "bioreagent.jwt")
@Data
public class JwtProperties {

    /**
     * JWT令牌统一配置
     */
    private String secretKey;
    private long ttl;
    private String tokenName;

}
