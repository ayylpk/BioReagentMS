package com.bioreagent.service;


import com.bioreagent.vo.InboundReportVO;
import com.bioreagent.vo.InventoryReportVO;

public interface WorkSpaceService {
    InventoryReportVO exportInventory();
    InboundReportVO exportInbound();
}
