import { describe, expect, it, vi } from 'vitest';

vi.mock('@nktkas/hyperliquid', () => ({
  HttpTransport: vi.fn(),
  InfoClient: vi.fn(),
  ExchangeClient: vi.fn(),
}));

describe('Hyperliquid trading — openPosition', () => {
  it('sets leverage then places IOC order with builder fee', async () => {
    const mockUpdateLeverage = vi.fn().mockResolvedValue({});
    const mockOrder = vi.fn().mockResolvedValue({
      response: {
        data: {
          statuses: [{ filled: { oid: 42, avgPx: '95100.0', totalSz: '0.01' } }],
        },
      },
    });
    const exchange = { updateLeverage: mockUpdateLeverage, order: mockOrder } as any;

    const { openPosition } = await import('../src/core/hyperliquid/trading.js');
    const result = await openPosition({
      exchange,
      assetIndex: 0,
      isBuy: true,
      size: '0.01',
      price: '95000',
      leverage: 5,
    });

    expect(result.oid).toBe(42);
    expect(result.avgPx).toBe('95100.0');
    expect(result.totalSz).toBe('0.01');

    // Verify leverage was set
    expect(mockUpdateLeverage).toHaveBeenCalledWith({
      asset: 0,
      isCross: true,
      leverage: 5,
    });

    // Verify order params
    const orderCall = mockOrder.mock.calls[0][0];
    expect(orderCall.orders[0].b).toBe(true); // isBuy
    expect(orderCall.orders[0].r).toBe(false); // not reduce-only
    expect(orderCall.orders[0].t).toEqual({ limit: { tif: 'Ioc' } });
    expect(orderCall.builder.f).toBe(50); // 0.05%
  });

  it('returns resting order for limit fills', async () => {
    const exchange = {
      updateLeverage: vi.fn().mockResolvedValue({}),
      order: vi.fn().mockResolvedValue({
        response: { data: { statuses: [{ resting: { oid: 99 } }] } },
      }),
    } as any;

    const { openPosition } = await import('../src/core/hyperliquid/trading.js');
    const result = await openPosition({
      exchange,
      assetIndex: 1,
      isBuy: false,
      size: '0.5',
      price: '3200',
      leverage: 10,
    });

    expect(result.oid).toBe(99);
    expect(result.avgPx).toBeUndefined();
  });

  it('throws ERR_HL_ORDER_FAILED on error status', async () => {
    const exchange = {
      updateLeverage: vi.fn().mockResolvedValue({}),
      order: vi.fn().mockResolvedValue({
        response: { data: { statuses: [{ error: 'Insufficient margin' }] } },
      }),
    } as any;

    const { openPosition } = await import('../src/core/hyperliquid/trading.js');
    try {
      await openPosition({ exchange, assetIndex: 0, isBuy: true, size: '1', price: '95000', leverage: 100 });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('ERR_HL_ORDER_FAILED');
      expect(err.message).toContain('Insufficient margin');
    }
  });

  it('handles waitingForFill status', async () => {
    const exchange = {
      updateLeverage: vi.fn().mockResolvedValue({}),
      order: vi.fn().mockResolvedValue({
        response: { data: { statuses: ['waitingForFill'] } },
      }),
    } as any;

    const { openPosition } = await import('../src/core/hyperliquid/trading.js');
    const result = await openPosition({
      exchange,
      assetIndex: 0,
      isBuy: true,
      size: '0.01',
      price: '95000',
      leverage: 1,
    });

    expect(result.oid).toBe(0);
  });
});

describe('Hyperliquid trading — closePosition', () => {
  it('places reduce-only IOC order', async () => {
    const mockOrder = vi.fn().mockResolvedValue({
      response: { data: { statuses: [{ filled: { oid: 55, avgPx: '96000.0', totalSz: '0.01' } }] } },
    });
    const exchange = { order: mockOrder } as any;

    const { closePosition } = await import('../src/core/hyperliquid/trading.js');
    const result = await closePosition({
      exchange,
      assetIndex: 0,
      isBuy: false,
      size: '0.01',
      price: '95000',
    });

    expect(result.oid).toBe(55);
    const orderCall = mockOrder.mock.calls[0][0];
    expect(orderCall.orders[0].r).toBe(true); // reduce-only
  });
});

describe('Hyperliquid trading — cancelOrder', () => {
  it('cancels order successfully', async () => {
    const mockCancel = vi.fn().mockResolvedValue({
      response: { data: { statuses: ['success'] } },
    });
    const exchange = { cancel: mockCancel } as any;

    const { cancelOrder } = await import('../src/core/hyperliquid/trading.js');
    await expect(cancelOrder({ exchange, assetIndex: 0, oid: 123 })).resolves.toBeUndefined();

    expect(mockCancel).toHaveBeenCalledWith({
      cancels: [{ a: 0, o: 123 }],
    });
  });

  it('throws on cancel error', async () => {
    const exchange = {
      cancel: vi.fn().mockResolvedValue({
        response: { data: { statuses: [{ error: 'Order not found' }] } },
      }),
    } as any;

    const { cancelOrder } = await import('../src/core/hyperliquid/trading.js');
    try {
      await cancelOrder({ exchange, assetIndex: 0, oid: 999 });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('ERR_HL_ORDER_FAILED');
    }
  });
});
