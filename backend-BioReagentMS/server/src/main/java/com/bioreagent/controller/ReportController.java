package com.bioreagent.controller;


import com.bioreagent.result.Result;
import com.bioreagent.service.ReportService;
import com.bioreagent.service.WorkSpaceService;
import com.bioreagent.vo.InboundRecordVO;
import com.bioreagent.vo.InboundReportVO;
import com.bioreagent.vo.InventoryReportVO;
import com.bioreagent.vo.ReagentVO;
import com.bioreagent.vo.TurnOverReportVO;
import lombok.extern.slf4j.Slf4j;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("report/")
@Slf4j
public class ReportController {

    @Autowired
    private ReportService reportService;

    @Autowired
    private WorkSpaceService workSpaceService;

    @GetMapping("top10/low")
    public Result<TurnOverReportVO> top10LowStock() {
        log.info("查询库存最少的 10 种试剂");
        TurnOverReportVO turnOverReportVO= reportService.top10LowStock();
        return Result.success(turnOverReportVO);
    }

    @GetMapping("top10/high")
    public Result<TurnOverReportVO> top10HighStock() {
        log.info("查询库存最多的 10 种试剂");
        TurnOverReportVO turnOverReportVO= reportService.top10HighStock();
        return Result.success(turnOverReportVO);
    }
    @GetMapping("top10/inbound")
    public Result<TurnOverReportVO> top10Inbound(
            @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate startDate,
            @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate endDate) {
        log.info("查询一段时间内入库最多的 10 种试剂：{},{}", startDate, endDate);
        TurnOverReportVO turnOverReportVO = reportService.top10Inbound(startDate, endDate);
        return Result.success(turnOverReportVO);
    }

    @GetMapping("top10/outbound")
    public Result<TurnOverReportVO> top10Outbound(
            @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate startDate,
            @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate endDate) {
        log.info("查询一段时间内出库最多的 10 种试剂：{},{}", startDate, endDate);
        TurnOverReportVO turnOverReportVO = reportService.top10Outbound(startDate, endDate);
        return Result.success(turnOverReportVO);
    }

    @GetMapping("export/inventory")
    public void exportInventory(HttpServletResponse response) throws IOException {
        // 1. 拿数据
        InventoryReportVO data = workSpaceService.exportInventory();

        // 2. 创建 Excel
        XSSFWorkbook wb = new XSSFWorkbook();
        Sheet sheet = wb.createSheet("库存报表");

        // ===== 样式 =====
        CellStyle titleStyle = wb.createCellStyle();
        Font titleFont = wb.createFont();
        titleFont.setBold(true); titleFont.setFontHeightInPoints((short) 14);
        titleStyle.setFont(titleFont); titleStyle.setAlignment(HorizontalAlignment.CENTER);

        CellStyle headerStyle = wb.createCellStyle();
        Font headerFont = wb.createFont();
        headerFont.setBold(true); headerFont.setFontHeightInPoints((short) 10);
        headerFont.setColor(IndexedColors.WHITE.getIndex());
        headerStyle.setFont(headerFont);
        headerStyle.setFillForegroundColor(IndexedColors.ROYAL_BLUE.getIndex());
        headerStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        headerStyle.setAlignment(HorizontalAlignment.CENTER);

        CellStyle summaryLabelStyle = wb.createCellStyle();
        Font slFont = wb.createFont();
        slFont.setBold(true); slFont.setFontHeightInPoints((short) 10);
        slFont.setColor(IndexedColors.GREY_80_PERCENT.getIndex());
        summaryLabelStyle.setFont(slFont); summaryLabelStyle.setAlignment(HorizontalAlignment.CENTER);

        CellStyle summaryValueStyle = wb.createCellStyle();
        Font svFont = wb.createFont();
        svFont.setBold(true); svFont.setFontHeightInPoints((short) 14);
        svFont.setColor(IndexedColors.ORANGE.getIndex());
        summaryValueStyle.setFont(svFont); summaryValueStyle.setAlignment(HorizontalAlignment.CENTER);

        CellStyle dataStyle = wb.createCellStyle();
        dataStyle.setAlignment(HorizontalAlignment.CENTER);

        // ===== 标题行 =====
        Row titleRow = sheet.createRow(0);
        Cell titleCell = titleRow.createCell(0);
        titleCell.setCellValue("BioReagentMS — 试剂库存报表");
        titleCell.setCellStyle(titleStyle);
        sheet.addMergedRegion(new org.apache.poi.ss.util.CellRangeAddress(0, 0, 0, 8));

        // ===== 概览数据（行2：标签，行3：数值） =====
        String[] summaryLabels = {"试剂种类总数", "库存总量", "库存不足预警", "效期临近预警", "在库批次总数"};
        Integer[] summaryValues = {
            data.getReagentTypeCount(), data.getTotalStock(),
            data.getShortageWarnings(), data.getExpiryWarnings(), data.getActiveBatchCount()
        };
        Row labelRow = sheet.createRow(2);
        Row valueRow = sheet.createRow(3);
        for (int i = 0; i < 5; i++) {
            Cell lc = labelRow.createCell(i);
            lc.setCellValue(summaryLabels[i]);
            lc.setCellStyle(summaryLabelStyle);
            Cell vc = valueRow.createCell(i);
            vc.setCellValue(summaryValues[i] != null ? summaryValues[i] : 0);
            vc.setCellStyle(summaryValueStyle);
        }

        // ===== 明细表头（行5） =====
        String[] headers = {"试剂名称", "CAS号", "规格", "纯度", "总库存", "单位", "存储条件", "安全阈值", "状态"};
        Row headerRow = sheet.createRow(5);
        for (int i = 0; i < headers.length; i++) {
            Cell hc = headerRow.createCell(i);
            hc.setCellValue(headers[i]);
            hc.setCellStyle(headerStyle);
        }

        // ===== 明细数据 =====
        List<ReagentVO> reagentList = data.getReagentList();
        int rowIdx = 6;
        if (reagentList != null) {
            for (ReagentVO r : reagentList) {
                Row dataRow = sheet.createRow(rowIdx++);
                Object[] vals = {r.getName(), r.getCasNumber(), r.getSpecification(), r.getPurity(),
                    r.getTotal(), r.getUnit(), r.getStorageCondition(),
                    r.getSafetyStockThreshold(), (r.getStatus() != null && r.getStatus() == 0) ? "启用" : "禁用"};
                for (int i = 0; i < vals.length; i++) {
                    Cell dc = dataRow.createCell(i);
                    if (vals[i] instanceof Integer) dc.setCellValue((Integer) vals[i]);
                    else if (vals[i] instanceof Long) dc.setCellValue(((Long) vals[i]).doubleValue());
                    else dc.setCellValue(vals[i] != null ? vals[i].toString() : "");
                    dc.setCellStyle(dataStyle);
                }
            }
        }

        // ===== 列宽 =====
        int[] widths = {5500, 4000, 3500, 2500, 2500, 2000, 3500, 2800, 2500};
        for (int i = 0; i < widths.length; i++) {
            sheet.setColumnWidth(i, widths[i]);
        }

        // ===== 输出到响应 =====
        String filename = URLEncoder.encode("库存报表.xlsx", StandardCharsets.UTF_8.toString());
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + filename);
        wb.write(response.getOutputStream());
        wb.close();
        log.info("库存报表导出完成，试剂种类：{}", data.getReagentTypeCount());
    }

    @GetMapping("export/inbound")
    public void exportInbound(HttpServletResponse response) throws IOException {
        InboundReportVO data = workSpaceService.exportInbound();

        XSSFWorkbook wb = new XSSFWorkbook();
        Sheet sheet = wb.createSheet("入库记录报表");

        // 样式
        CellStyle titleStyle = wb.createCellStyle();
        Font titleFont = wb.createFont();
        titleFont.setBold(true); titleFont.setFontHeightInPoints((short) 14);
        titleStyle.setFont(titleFont); titleStyle.setAlignment(HorizontalAlignment.CENTER);

        CellStyle headerStyle = wb.createCellStyle();
        Font headerFont = wb.createFont();
        headerFont.setBold(true); headerFont.setFontHeightInPoints((short) 10);
        headerFont.setColor(IndexedColors.WHITE.getIndex());
        headerStyle.setFont(headerFont);
        headerStyle.setFillForegroundColor(IndexedColors.ROYAL_BLUE.getIndex());
        headerStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        headerStyle.setAlignment(HorizontalAlignment.CENTER);

        CellStyle labelStyle = wb.createCellStyle();
        Font lFont = wb.createFont();
        lFont.setBold(true); lFont.setFontHeightInPoints((short) 10);
        lFont.setColor(IndexedColors.GREY_80_PERCENT.getIndex());
        labelStyle.setFont(lFont); labelStyle.setAlignment(HorizontalAlignment.CENTER);

        CellStyle valueStyle = wb.createCellStyle();
        Font vFont = wb.createFont();
        vFont.setBold(true); vFont.setFontHeightInPoints((short) 14);
        vFont.setColor(IndexedColors.ORANGE.getIndex());
        valueStyle.setFont(vFont); valueStyle.setAlignment(HorizontalAlignment.CENTER);

        CellStyle dataStyle = wb.createCellStyle();
        dataStyle.setAlignment(HorizontalAlignment.CENTER);

        // 标题
        Row titleRow = sheet.createRow(0);
        Cell tc = titleRow.createCell(0);
        tc.setCellValue("BioReagentMS — 入库记录报表（近30天）");
        tc.setCellStyle(titleStyle);
        sheet.addMergedRegion(new org.apache.poi.ss.util.CellRangeAddress(0, 0, 0, 7));

        // 概览
        String[] labels = {"入库总次数", "入库试剂种类", "入库总数量", "入库总金额（元）"};
        Object[] values = {data.getTotalOfTime(), data.getTotalOfKind(), data.getTotalOfStock(), data.getTotalOfPrice()};
        Row lRow = sheet.createRow(2);
        Row vRow = sheet.createRow(3);
        for (int i = 0; i < 4; i++) {
            Cell lc = lRow.createCell(i); lc.setCellValue(labels[i]); lc.setCellStyle(labelStyle);
            Cell vc = vRow.createCell(i);
            if (values[i] instanceof Number) {
                vc.setCellValue(((Number) values[i]).doubleValue());
            } else {
                vc.setCellValue(values[i] != null ? values[i].toString() : "0");
            }
            vc.setCellStyle(valueStyle);
        }

        // 明细表头
        String[] headers = {"入库单号", "试剂名称", "入库数量", "单价（元）", "金额（元）", "操作人", "入库时间", "备注"};
        Row hRow = sheet.createRow(5);
        for (int i = 0; i < headers.length; i++) {
            Cell hc = hRow.createCell(i); hc.setCellValue(headers[i]); hc.setCellStyle(headerStyle);
        }

        // 明细数据
        List<InboundRecordVO> list = data.getRecordList();
        int rowIdx = 6;
        if (list != null) {
            for (InboundRecordVO r : list) {
                Row dRow = sheet.createRow(rowIdx++);
                Object[] vs = {r.getReceiptNumber(), r.getReagentName(), r.getQuantity(),
                    r.getUnitPrice(), r.getTotalAmount(), r.getOperatorName(),
                    r.getReceiptTime() != null ? r.getReceiptTime().toString() : "", r.getRemark()};
                for (int i = 0; i < vs.length; i++) {
                    Cell dc = dRow.createCell(i);
                    if (vs[i] instanceof Integer) dc.setCellValue((Integer) vs[i]);
                    else if (vs[i] instanceof Double) dc.setCellValue((Double) vs[i]);
                    else dc.setCellValue(vs[i] != null ? vs[i].toString() : "");
                    dc.setCellStyle(dataStyle);
                }
            }
        }

        int[] widths = {6000, 5000, 2500, 3500, 3500, 3000, 5000, 6000};
        for (int i = 0; i < widths.length; i++) sheet.setColumnWidth(i, widths[i]);

        String filename = URLEncoder.encode("入库记录报表.xlsx", StandardCharsets.UTF_8.toString());
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + filename);
        wb.write(response.getOutputStream());
        wb.close();
        log.info("入库报表导出完成，入库次数：{}", data.getTotalOfTime());
    }

}
