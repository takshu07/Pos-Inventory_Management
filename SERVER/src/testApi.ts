import express from 'express';
import { customerService } from './services/customer.service';

const router = express.Router();

router.get('/:phone', async (req, res) => {
  try {
    const customer = await customerService.getCustomerByPhone(req.params.phone);
    res.json({ success: true, data: customer });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
