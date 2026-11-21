import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// GET /api/invoices/[id]/export-image?format=jpg|pdf
// PRD Part 38 §5.1: HTML-to-Canvas Invoice Exporter for WhatsApp HD image sharing
// §SECURITY: Requires authentication + business ownership of the invoice.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params
    const { searchParams } = new URL(req.url)
    const format = searchParams.get('format') || 'jpg'

    // §OWNERSHIP: findFirst with businessId — never findUnique by id alone.
    const invoice = await db.invoice.findFirst({
      where: { id, businessId: business.id },
      include: { party: true, items: { include: { product: true } } },
    })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    // §DECIMAL-SAFETY: Convert all Prisma Decimal fields to numbers before HTML
    // generation. This prevents [object Object] or string concatenation in the
    // invoice template. The invoice object is not returned to the client — only
    // the generated HTML is returned as a base64 data URL.
    const safeInvoice = serializeDecimals(invoice)
    const html = generateInvoiceHTML(safeInvoice, business)
    const htmlBase64 = Buffer.from(html).toString('base64')
    const dataUrl = `data:text/html;base64,${htmlBase64}`

    return NextResponse.json({
      ok: true,
      format,
      html: dataUrl,
      invoiceNumber: invoice.invoiceNumber,
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

function generateInvoiceHTML(invoice: any, business: any): string {
  const items = invoice.items || []
  const formatDate = (d: Date) => new Date(d).toLocaleDateString('en-IN')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}body{font-family:Helvetica,sans-serif;width:400px;padding:20px;background:#fff}
  .header{text-align:center;margin-bottom:20px}.header h1{font-size:20px;color:#1a7a42}.header p{font-size:12px;color:#666}
  .inv-info{display:flex;justify-content:space-between;margin-bottom:15px;font-size:12px}.inv-info .label{color:#999}.inv-info .value{font-weight:bold}
  .party{background:#f5f5f5;padding:10px;border-radius:8px;margin-bottom:15px;font-size:12px}.party .name{font-weight:bold;font-size:14px}
  table{width:100%;border-collapse:collapse;margin-bottom:15px}th{text-align:left;font-size:10px;color:#999;padding:8px;border-bottom:2px solid #1a7a42}
  td{font-size:11px;padding:8px;border-bottom:1px solid #eee}.totals{margin-left:auto;width:50%}
  .totals .row{display:flex;justify-content:space-between;font-size:12px;padding:4px 0}.totals .grand{font-weight:bold;font-size:16px;color:#1a7a42;border-top:2px solid #1a7a42;padding-top:8px}
  .footer{text-align:center;font-size:10px;color:#999;margin-top:20px}
  .status{display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:bold}
  .status.paid{background:#d1fae5;color:#065f46}.status.unpaid{background:#fee2e2;color:#991b1b}.status.partial{background:#fef3c7;color:#92400e}
  </style></head><body>
  <div class="header"><h1>${business.name||'BizLedger'}</h1><p>${business.address||''} ${business.phone?'· '+business.phone:''}</p>${business.gstin?'<p>GSTIN: '+business.gstin+'</p>':''}</div>
  <div class="inv-info"><div><div class="label">Invoice No</div><div class="value">${invoice.invoiceNumber}</div></div><div><div class="label">Date</div><div class="value">${formatDate(invoice.createdAt)}</div></div><div><div class="label">Status</div><div><span class="status ${invoice.status}">${invoice.status.toUpperCase()}</span></div></div></div>
  <div class="party"><div class="name">${invoice.party?.name||'Walk-in Customer'}</div>${invoice.party?.phone?'<div>'+invoice.party.phone+'</div>':''}${invoice.party?.address?'<div>'+invoice.party.address+'</div>':''}</div>
  <table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${items.map((i:any)=>`<tr><td>${i.name}</td><td>${i.quantity}</td><td>₹${i.unitPrice}</td><td>₹${i.total}</td></tr>`).join('')}</tbody></table>
  <div class="totals"><div class="row"><span>Subtotal</span><span>₹${invoice.subtotal}</span></div>${invoice.discountAmount>0?`<div class="row"><span>Discount</span><span>-₹${invoice.discountAmount}</span></div>`:''}${invoice.gstAmount>0?`<div class="row"><span>GST</span><span>₹${invoice.gstAmount}</span></div>`:''}<div class="row grand"><span>Total</span><span>₹${invoice.grandTotal}</span></div>${invoice.amountDue>0?`<div class="row" style="color:#991b1b"><span>Due</span><span>₹${invoice.amountDue}</span></div>`:''}</div>
  <div class="footer"><p>Powered by BizLedger · Digital Khata for Modern Business</p>${business.upiId?'<p>Pay via UPI: '+business.upiId+'</p>':''}</div>
  </body></html>`
}
