package com.bioreagent.service;

import com.bioreagent.vo.TurnOverReportVO;

import java.time.LocalDate;

public interface ReportService {

    TurnOverReportVO top10LowStock();

    TurnOverReportVO top10HighStock();

    TurnOverReportVO top10Inbound(LocalDate startDate, LocalDate endDate);

    TurnOverReportVO top10Outbound(LocalDate startDate, LocalDate endDate);
}
