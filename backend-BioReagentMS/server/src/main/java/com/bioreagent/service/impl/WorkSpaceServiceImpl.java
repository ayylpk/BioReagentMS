package com.bioreagent.service.impl;


import com.bioreagent.entity.Reagent;
import com.bioreagent.mapper.WorkSpaceMapper;
import com.bioreagent.service.WorkSpaceService;
import com.bioreagent.vo.InboundReportVO;
import com.bioreagent.vo.InventoryReportVO;
import com.bioreagent.vo.ReagentVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class WorkSpaceServiceImpl implements WorkSpaceService {

    @Autowired
    private WorkSpaceMapper workSpaceMapper;

    @Override
    public InventoryReportVO exportInventory() {

        InventoryReportVO inventoryReportVO = workSpaceMapper.getKindAndStock();
        inventoryReportVO.setActiveBatchCount(workSpaceMapper.getActiveBatchCount());
        inventoryReportVO.setShortageWarnings(workSpaceMapper.getShortageWarningCount());
        inventoryReportVO.setExpiryWarnings(workSpaceMapper.getExpiryWarningCount());
        List<Reagent> reagentList = workSpaceMapper.getList();
        List<ReagentVO> reagentVOList = new ArrayList<>();
        for (Reagent reagent : reagentList) {
            ReagentVO reagentVO = new ReagentVO(reagent.getId(), reagent.getName(), reagent.getCasNumber(), reagent.getSpecification(), reagent.getPurity(), reagent.getCategoryId(), reagent.getUnit(), reagent.getStorageCondition(), reagent.getSafetyStockThreshold(), reagent.getWarningAdvanceDays(), reagent.getStatus(), reagent.getTotalStock());
            reagentVOList.add(reagentVO);
        }

        inventoryReportVO.setReagentList(reagentVOList);

        return inventoryReportVO;
    }

    @Override
    public InboundReportVO exportInbound() {
        InboundReportVO vo = workSpaceMapper.getInboundSummary();
        vo.setRecordList(workSpaceMapper.getInboundList());
        return vo;
    }
}
