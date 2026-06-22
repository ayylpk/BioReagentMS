package com.bioreagent.service.impl;

import com.bioreagent.entity.Reagent;
import com.bioreagent.mapper.ReagentMapper;
import com.bioreagent.mapper.ReportMapper;
import com.bioreagent.service.ReportService;
import com.bioreagent.service.WorkSpaceService;
import com.bioreagent.vo.InboundRankVO;
import com.bioreagent.vo.OutboundRankVO;
import com.bioreagent.vo.ReagentVO;
import com.bioreagent.vo.TurnOverReportVO;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

@Service
public class ReportServiceImpl implements ReportService {

    @Autowired
    private ReportMapper reportMapper;

    @Autowired
    private ReagentMapper reagentMapper;

    @Autowired
    private WorkSpaceService workSpaceService;

    @Override
    public TurnOverReportVO top10LowStock() {

        List<Reagent> list = reportMapper.top10LowStock();

        List<String> regentName = new ArrayList<>();
        List<Integer> number = new ArrayList<>();

        for (Reagent reagent : list) {
            regentName.add(reagent.getName());
            number.add(reagent.getTotalStock());
        }

        TurnOverReportVO turnOverReportVO = new TurnOverReportVO(StringUtils.join(regentName,","), StringUtils.join(number,","));

        return turnOverReportVO;
    }

    @Override
    public TurnOverReportVO top10HighStock() {
        List<Reagent> list = reportMapper.top10HighStock();

        List<String> regentName = new ArrayList<>();
        List<Integer> number = new ArrayList<>();

        for (Reagent reagent : list) {
            regentName.add(reagent.getName());
            number.add(reagent.getTotalStock());
        }

        TurnOverReportVO turnOverReportVO = new TurnOverReportVO(StringUtils.join(regentName,","), StringUtils.join(number,","));

        return turnOverReportVO;
    }

    @Override
    public TurnOverReportVO top10Inbound(LocalDate startDate, LocalDate endDate) {

        LocalDateTime startTime = startDate.atStartOfDay();
        LocalDateTime endTime = endDate.atTime(LocalTime.MAX);

        List<InboundRankVO> list = reportMapper.top10Inbound(startTime, endTime);

        List<String> reagentNames = new ArrayList<>();
        List<Integer> quantities = new ArrayList<>();

        for (InboundRankVO rank : list) {
            Reagent reagent = reagentMapper.getById(rank.getReagentId());
            reagentNames.add(reagent != null ? reagent.getName() : "未知试剂#" + rank.getReagentId());
            quantities.add(rank.getTotalQuantity());
        }

        return new TurnOverReportVO(StringUtils.join(reagentNames, ","), StringUtils.join(quantities, ","));
    }

    @Override
    public TurnOverReportVO top10Outbound(LocalDate startDate, LocalDate endDate) {

        LocalDateTime startTime = startDate.atStartOfDay();
        LocalDateTime endTime = endDate.atTime(LocalTime.MAX);

        List<OutboundRankVO> list = reportMapper.top10Outbound(startTime, endTime);

        List<String> reagentNames = new ArrayList<>();
        List<Integer> quantities = new ArrayList<>();

        for (OutboundRankVO rank : list) {
            Reagent reagent = reagentMapper.getById(rank.getReagentId().longValue());
            reagentNames.add(reagent != null ? reagent.getName() : "未知试剂#" + rank.getReagentId());
            quantities.add(rank.getTotalQuantity());
        }

        return new TurnOverReportVO(StringUtils.join(reagentNames, ","), StringUtils.join(quantities, ","));
    }

}
