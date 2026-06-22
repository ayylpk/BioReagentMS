package com.bioreagent.scheduled;

import com.bioreagent.service.WarningService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 预警定时任务 —— 每天扫描一次效期和库存
 */
@Slf4j
@Component
@EnableScheduling
public class WarningScheduler {

    @Autowired
    private WarningService warningService;

    /** 每天早上 0:00 执行 */
    @Scheduled(cron = "0 0 0 * * ?")
    public void scan() {
        log.info("定时扫描预警开始");
        warningService.generateWarnings();
        log.info("定时扫描预警结束");
    }
}
