package com.bioreagent.service.impl;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.bioreagent.QueryParam.ReagentBatchQueryParam;
import com.bioreagent.QueryParam.ReagentQueryParam;
import com.bioreagent.QueryParam.WarningRecordQueryParam;
import com.bioreagent.constant.MessageConstant;
import com.bioreagent.constant.WarningConstant;
import com.bioreagent.dto.WarningRecordDTO;
import com.bioreagent.entity.Reagent;
import com.bioreagent.entity.ReagentBatch;
import com.bioreagent.entity.WarningRecord;
import com.bioreagent.mapper.ReagentBatchMapper;
import com.bioreagent.mapper.ReagentMapper;
import com.bioreagent.mapper.WarningMapper;
import com.bioreagent.result.PageResult;
import com.bioreagent.service.WarningService;
import com.bioreagent.vo.WarningRecordVO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
public class WarningServiceImpl implements WarningService {

    @Autowired
    private WarningMapper warningMapper;

    @Autowired
    private ReagentMapper reagentMapper;

    @Autowired
    private ReagentBatchMapper reagentBatchMapper;


    @Override
    public PageResult<WarningRecordVO> page(WarningRecordQueryParam queryParam) {
        PageHelper.startPage(queryParam.getPage(), queryParam.getPageSize());
        List<WarningRecord> list = warningMapper.page(queryParam);
        Page<WarningRecord> p = (Page<WarningRecord>) list;

        List<WarningRecordVO> voList = p.getResult().stream()
                .map(this::toVO)
                .collect(Collectors.toList());
        return new PageResult<>(p.getTotal(), voList);
    }

    @Override
    public Integer countUnresolved() {
        return warningMapper.countByStatus(WarningConstant.STATUS_UNRESOLVED);
    }


    @Override
    public void add(WarningRecordDTO dto) {
        if (dto.getStatus() == null) {
            dto.setStatus(WarningConstant.STATUS_UNRESOLVED);
        }
        warningMapper.insert(dto);
    }


    @Override
    public void resolve(Integer warningId, Integer resolvedBy) {
        WarningRecord warning = warningMapper.getById(warningId);
        if (warning == null) {
            throw new RuntimeException(MessageConstant.WARNING_NOT_FOUND);
        }
        if (WarningConstant.STATUS_RESOLVED.equals(warning.getStatus())) {
            throw new RuntimeException(MessageConstant.WARNING_ALREADY_RESOLVED);
        }

        // 二次核验
        if (WarningConstant.TYPE_EXPIRY.equals(warning.getWarningType())) {
            verifyExpiryResolved(warning);
        } else if (WarningConstant.TYPE_SHORTAGE.equals(warning.getWarningType())) {
            verifyShortageResolved(warning);
        }

        // 核验通过
        warningMapper.resolve(warningId,
                WarningConstant.STATUS_RESOLVED,
                LocalDateTime.now(),
                resolvedBy);
    }


    private void verifyExpiryResolved(WarningRecord warning) {
        Reagent reagent = reagentMapper.getById(warning.getReagentId().longValue());
        if (reagent == null) return;   // 试剂已删，威胁解除

        // 按试剂ID + 批号精确查这个批次
        ReagentBatchQueryParam batchParam = new ReagentBatchQueryParam();
        batchParam.setReagentId(warning.getReagentId().longValue());
        batchParam.setBatchNumber(warning.getReagentBatch());
        batchParam.setPageSize(1);
        List<ReagentBatch> batches = reagentBatchMapper.list(batchParam);

        // 批次查不到了（已删除）→ 威胁解除
        if (batches.isEmpty()) return;

        ReagentBatch batch = batches.get(0);

        // 批次已用完或已过期 → 威胁解除
        if (batch.getStatus() == 2 || batch.getStatus() == 3) return;

        // 库存为 0 → 威胁解除
        if (batch.getCurrentQuantity() == null || batch.getCurrentQuantity() <= 0) return;

        // 批次还在且有效，检查是否仍处于预警范围
        if (batch.getExpiryDate() != null) {
            int advanceDays = reagent.getWarningAdvanceDays() != null ? reagent.getWarningAdvanceDays() : 0;
            long days = batch.getExpiryDate().toEpochDay() - LocalDate.now().toEpochDay();
            if (days < advanceDays) {
                throw new RuntimeException(
                        String.format("批次 %s 仍处于即将过期状态（剩余 %d 天），无法标记已处理",
                                warning.getReagentBatch(), days));
            }
        }
    }

    /**
     * 库存不足预警核验：检查当前库存是否恢复到阈值以上
     */
    private void verifyShortageResolved(WarningRecord warning) {
        Reagent reagent = reagentMapper.getById(warning.getReagentId().longValue());
        if (reagent == null) return;

        int threshold = reagent.getSafetyStockThreshold() != null ? reagent.getSafetyStockThreshold() : 0;
        Integer totalStock = reagent.getTotalStock();
        if (totalStock == null) totalStock = 0;

        if (totalStock >= threshold) return;   // 库存已恢复

        // 库存为 0 → 生成新预警
        if (totalStock == 0) {
            WarningRecord existing = warningMapper.getByReagentAndType(
                    warning.getReagentId(),
                    WarningConstant.TYPE_SHORTAGE,
                    WarningConstant.STATUS_UNRESOLVED);
            if (existing == null) {
                WarningRecordDTO dto = new WarningRecordDTO();
                dto.setReagentId(warning.getReagentId());
                dto.setReagentName(reagent.getName());
                dto.setWarningType(WarningConstant.TYPE_SHORTAGE);
                dto.setStatus(WarningConstant.STATUS_UNRESOLVED);
                warningMapper.insert(dto);
                log.info("库存为 0，自动生成新预警 → reagentId={}", warning.getReagentId());
            }
            throw new RuntimeException("库存已降至 0，已生成新预警");
        }

        throw new RuntimeException(String.format("库存仍低于安全阈值（当前: %d, 阈值: %d），无法标记已处理",
                totalStock, threshold));
    }


    @Override
    public void generateWarnings() {
        ReagentQueryParam reagentParam = new ReagentQueryParam();
        reagentParam.setPageSize(Integer.MAX_VALUE);
        List<Reagent> reagents = reagentMapper.list(reagentParam);

        for (Reagent reagent : reagents) {
            if (reagent.getStatus() != null && reagent.getStatus() == 1) continue;

            Long reagentId = reagent.getId();
            Integer threshold = reagent.getSafetyStockThreshold();
            Integer advanceDays = reagent.getWarningAdvanceDays();

            // 库存不足预警
            if (threshold != null && threshold > 0) {
                Integer totalStock = reagent.getTotalStock();
                if (totalStock == null) totalStock = 0;
                if (totalStock < threshold) {
                    createIfNotExist(reagentId.intValue(), reagent.getName(),
                            null, WarningConstant.TYPE_SHORTAGE);
                }
            }

            if (advanceDays != null && advanceDays > 0) {
                ReagentBatchQueryParam batchParam = new ReagentBatchQueryParam();
                batchParam.setReagentId(reagentId);
                batchParam.setPageSize(Integer.MAX_VALUE);
                List<ReagentBatch> batches = reagentBatchMapper.list(batchParam);

                for (ReagentBatch batch : batches) {
                    if (batch.getStatus() != 0 && batch.getStatus() != 1) continue;
                    if (batch.getCurrentQuantity() == null || batch.getCurrentQuantity() <= 0) continue;
                    if (batch.getExpiryDate() == null) continue;

                    long days = batch.getExpiryDate().toEpochDay() - LocalDate.now().toEpochDay();
                    if (days >= 0 && days < advanceDays) {
                        createIfNotExist(reagentId.intValue(), reagent.getName(),
                                batch.getBatchNumber(), WarningConstant.TYPE_EXPIRY);
                    }
                }
            }
        }
        log.info("预警扫描完成");
    }

    private void createIfNotExist(Integer reagentId, String reagentName,
                                  String reagentBatch, String warningType) {
        WarningRecord existing = warningMapper.getByReagentAndType(
                reagentId, warningType, WarningConstant.STATUS_UNRESOLVED);
        if (existing != null) return;

        WarningRecordDTO dto = new WarningRecordDTO();
        dto.setReagentId(reagentId);
        dto.setReagentName(reagentName);
        dto.setReagentBatch(reagentBatch);
        dto.setWarningType(warningType);
        dto.setStatus(WarningConstant.STATUS_UNRESOLVED);
        warningMapper.insert(dto);
    }


    private WarningRecordVO toVO(WarningRecord record) {
        WarningRecordVO vo = new WarningRecordVO();
        BeanUtils.copyProperties(record, vo);
        return vo;
    }
}
